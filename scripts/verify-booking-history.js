const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {signIn,adminToken} = require('./local-auth');
const report = {timestamp:new Date().toISOString(),checks:[]};
function pass(name) { report.checks.push({name,passed:true}); console.log(`PASS: ${name}`); }
async function request(port, route, {token,method='GET',body,key}={}) {
  const response=await fetch(`http://[::1]:${port}/api/v1${route}`,{method,
    headers:{'content-type':'application/json',...(token?{'x-access-token':token}:{}),...(key?{'Idempotency-Key':key}:{})},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
  return {status:response.status,body:await response.json(),headers:response.headers};
}
async function customer() {
  const email=`history-${crypto.randomUUID()}@example.test`, password=crypto.randomBytes(20).toString('hex');
  const result=await request(3001,'/signup',{method:'POST',body:{email,password}});
  assert.equal(result.status,200);
  return {email,password,id:result.body.data.response.id,token:await signIn(email,password)};
}
async function main() {
  const user=await customer(), other=await customer(), admin=await adminToken();
  assert.equal((await request(3003,'/booking')).status,401);
  assert.equal((await request(3003,'/booking',{token:'invalid'})).status,401);
  pass('History requires a valid token');
  const catalog=(await request(3002,'/catalog')).body.data;
  assert.ok(catalog.airports.length>=2 && catalog.airplanes.length,'Seed the demo catalog first');
  const created=await request(3002,'/flights',{method:'POST',token:admin,body:{
    flightNumber:`HIST-${Date.now()}`,airplaneId:catalog.airplanes.find(plane=>plane.capacity>=3).id,
    departureAirportId:catalog.airports[0].id,arrivalAirportId:catalog.airports[1].id,
    departureTime:'2099-01-01T10:00:00Z',arrivalTime:'2099-01-01T12:00:00Z',price:2500}});
  assert.equal(created.status,201);
  const flight=created.body.data, bookings=[];
  try {
    for(let i=0;i<3;i++) {
      const booked=await request(3003,'/booking',{method:'POST',token:user.token,key:crypto.randomUUID(),body:{flightId:flight.id,noOfSeats:1}});
      assert.equal(booked.status,200);bookings.push(booked.body.data);
    }
    // Sign in afresh: history and cancellation do not receive any original request keys.
    const token=await signIn(user.email,user.password);
    const first=await request(3003,'/booking?limit=2',{token});
    assert.equal(first.status,200);assert.equal(first.body.data.items.length,2);
    assert.match(first.headers.get('cache-control'),/private, no-store/);
    assert.deepEqual(first.body.data.items.map(row=>row.id),bookings.slice(1).reverse().map(row=>row.id));
    const next=await request(3003,`/booking?limit=2&beforeId=${first.body.data.nextCursor}`,{token});
    assert.deepEqual(next.body.data.items.map(row=>row.id),[bookings[0].id]);assert.equal(next.body.data.nextCursor,null);
    pass('Fresh sign-in retrieves durable history with stable cursor pagination');
    for(const row of first.body.data.items) for(const field of ['requestKey','traceParent','notificationEmail','nextAttemptAt']) assert.equal(row[field],undefined);
    pass('History omits internal keys, trace context, and notification addresses');
    assert.deepEqual((await request(3003,`/booking?userId=${user.id}`,{token:other.token})).body.data.items,[]);
    assert.equal((await request(3003,`/booking/${bookings[0].id}`,{token:other.token})).status,404);
    assert.equal((await request(3003,`/booking/${bookings[0].id}/cancel`,{method:'POST',token:other.token})).status,404);
    pass('Another user cannot list, read, or cancel these bookings');
    for(const query of ['limit=0','limit=51','beforeId=-1','beforeId=abc']) assert.equal((await request(3003,`/booking?${query}`,{token})).status,400);
    pass('Invalid pagination is rejected');
    for(let i=0;i<2;i++) assert.equal((await request(3003,`/booking/${bookings[0].id}/cancel`,{method:'POST',token})).status,200);
    const detail=await request(3003,`/booking/${bookings[0].id}`,{token});
    assert.equal(detail.body.data.status,'Cancelled');assert.equal(detail.body.data.reservationReleased,true);
    const remaining=(await request(3002,`/flights/${flight.id}`)).body.data.totalSeats;
    assert.equal(remaining,flight.totalSeats-2);
    pass('Owner cancellation works without a browser key and repeated calls release seats once');
  } finally {
    for(const booking of bookings) await request(3003,`/booking/${booking.id}/cancel`,{method:'POST',token:user.token});
  }
  report.passed=true;
}
main().catch(error=>{report.passed=false;report.error=error.message;console.error(error.message);process.exitCode=1;}).finally(()=>{
  fs.writeFileSync(path.join(__dirname,'../docs/booking-history-results.json'),JSON.stringify(report,null,2)+'\n');
});
