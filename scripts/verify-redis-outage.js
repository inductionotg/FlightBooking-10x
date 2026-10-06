// Run while the dedicated Redis container is stopped. No real notifications/payments.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
let token;
const fixture=JSON.parse(fs.readFileSync(path.join(root,'.local/redis-test-fixture.json')));
const env=require(path.join(root,'FlightandSearchService/node_modules/dotenv')).parse(fs.readFileSync(path.join(root,'FlightandSearchService/.env')));
async function request(port,route,method='GET',data,key){
  const response=await fetch(`http://[::1]:${port}${route}`,{method,headers:{'Content-Type':'application/json','x-access-token':token,'x-reservation-key':env.RESERVATION_SERVICE_KEY,...(key?{'Idempotency-Key':key}:{})},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(5000)});
  assert.equal(response.status,200);return (await response.json()).data;
}
async function main(){
  token=await require('./local-auth').adminToken();
  const started=Date.now();
  const metrics=await request(3002,'/api/v1/internal/cache-metrics');assert.equal(metrics.ready,false);
  const before=await request(3002,`/api/v1/flights/${fixture.flightId}`);
  const key=crypto.randomUUID();
  const booking=await request(3003,'/api/v1/booking','POST',{flightId:fixture.flightId,userId:987654,noOfSeats:1},key);
  assert.equal(booking.status,'Booked');
  const after=await request(3002,fixture.route);assert.equal(after[0].totalSeats,before.totalSeats-1);
  await request(3003,`/api/v1/booking/${booking.id}/cancel`,'POST',{userId:987654},key);
  assert.equal((await request(3002,`/api/v1/flights/${fixture.flightId}`)).totalSeats,before.totalSeats);
  const report={timestamp:new Date().toISOString(),passed:true,elapsedMs:Date.now()-started,checks:['Redis confirmed offline','detail and search use MySQL','booking succeeds despite failed cache invalidation','cancellation succeeds and inventory is restored'],metrics:await request(3002,'/api/v1/internal/cache-metrics')};
  fs.writeFileSync(path.join(root,'docs/redis-outage-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
