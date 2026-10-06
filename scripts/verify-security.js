const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {signIn, adminToken} = require('./local-auth');

async function request(port, route, {method='GET', body, token, key}={}) {
  const response = await fetch(`http://[::1]:${port}/api/v1${route}`, {
    method, headers:{...(body ? {'content-type':'application/json'} : {}),
      ...(token ? {'x-access-token':token} : {}), ...(key ? {'Idempotency-Key':key} : {})},
    body:body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(12000)
  });
  return {status:response.status, body:await response.json()};
}
async function customer() {
  const email=`security-${crypto.randomUUID()}@example.test`;
  const password=crypto.randomBytes(18).toString('base64url');
  assert.equal((await request(3001, '/signup', {method:'POST',body:{email,password}})).status,200);
  const token=await signIn(email,password);
  const me=await request(3001, '/me', {token});
  assert.equal(me.status,200);
  assert.ok(!me.body.data.roles.includes('ADMIN'));
  return {token, id:me.body.data.id};
}
async function main() {
  const admin=await adminToken();
  const user=await customer();
  const other=await customer();
  assert.equal((await request(3001,'/me',{token:'invalid'})).status,401);
  assert.equal((await request(3001,`/user/${other.id}`,{token:user.token})).status,403);
  assert.equal((await request(3001,`/signup/${other.id}`,{method:'DELETE',token:user.token})).status,403);
  for (const [method,route] of [['POST','/cityAll'],['PATCH','/city/1'],['DELETE','/city/1'],
    ['POST','/airports'],['POST','/airplanes'],['POST','/flights'],['POST','/flights/1']]) {
    assert.equal((await request(3002,route,{method,body:{},token:user.token})).status,403,`${method} ${route}`);
  }
  const cityName=`Security check ${crypto.randomUUID()}`;
  assert.equal((await request(3002,'/city',{method:'POST',body:{name:cityName}})).status,401);
  assert.equal((await request(3002,'/city',{method:'POST',body:{name:cityName},token:'invalid'})).status,401);
  assert.equal((await request(3002,'/city',{method:'POST',body:{name:cityName},token:user.token})).status,403);
  const city=await request(3002,'/city',{method:'POST',body:{name:cityName},token:admin});
  assert.ok([200,201].includes(city.status),`Admin city creation: ${city.status}`);
  const cityId=city.body.data.id;
  assert.ok(cityId);
  assert.ok((await request(3002,`/city/${cityId}`,{method:'DELETE',token:admin})).status < 300);
  assert.equal((await request(3003,'/booking',{method:'POST',body:{flightId:1,noOfSeats:1}})).status,401);
  const flights=await request(3002,'/flights');
  assert.equal(flights.status,200);
  const flight=flights.body.data.find(item => Number(item.totalSeats)>0 && new Date(item.departureTime)>new Date());
  assert.ok(flight,'Need at least one future flight with seats; run seed-demo-catalog.js');
  const key=crypto.randomUUID();
  const booked=await request(3003,'/booking',{method:'POST',token:user.token,key,
    body:{flightId:flight.id,noOfSeats:1,userId:other.id}});
  assert.equal(booked.status,200,`Booking: ${JSON.stringify(booked.body)}`);
  assert.equal(booked.body.data.userId,user.id,'Forged body userId must be ignored');
  const retried=await request(3003,'/booking',{method:'POST',token:user.token,key,
    body:{flightId:flight.id,noOfSeats:1}});
  assert.equal(retried.body.data.id,booked.body.data.id,'Token identity must preserve retry idempotency');
  const id=booked.body.data.id;
  const denied=await request(3003,`/booking/${id}/cancel`,{method:'POST',token:other.token,key,body:{userId:user.id}});
  assert.ok([403,404].includes(denied.status),`Other user cancellation: ${denied.status}`);
  const cancelled=await request(3003,`/booking/${id}/cancel`,{method:'POST',token:user.token,key,body:{userId:other.id}});
  assert.ok([200,202].includes(cancelled.status),`Owner cancellation: ${cancelled.status}`);
  console.log(JSON.stringify({passed:true,checks:['missing/invalid auth 401','customer admin write 403','admin create/delete','booking token identity','cross-user cancellation denied','owner cancellation'],bookingId:id}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
