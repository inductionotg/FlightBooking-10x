const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
require(path.join(root,'FlightandSearchService/node_modules/dotenv')).config({path:path.join(root,'FlightandSearchService/.env')});
const {FlightCache,cache,searchKey}=require(path.join(root,'FlightandSearchService/src/utils/flight-cache'));
const db=require(path.join(root,'FlightandSearchService/src/models'));
db.sequelize.options.logging=false;
const report={timestamp:new Date().toISOString(),checks:[]};
const instances=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function pass(name){report.checks.push({name,passed:true});console.log(`PASS: ${name}`);}
async function createCache(options={}){
  const instance=new FlightCache({url:'redis://127.0.0.1:36379',prefix:`test:${crypto.randomUUID()}:`,...options});instances.push(instance);
  for(let i=0;i<100&&!instance.client.isReady;i++)await sleep(50);
  assert.ok(instance.client.isReady);return instance;
}
async function request(port,route,method='GET',data,key){
  const response=await fetch(`http://[::1]:${port}${route}`,{method,headers:{'Content-Type':'application/json','x-reservation-key':process.env.RESERVATION_SERVICE_KEY,...(key?{'Idempotency-Key':key}:{})},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,200===response.status?200:method==='POST'&&route==='/api/v1/flights'?201:200,`${route} returned ${response.status}`);
  return (await response.json()).data;
}
async function main(){
  const c=await createCache();let loads=0;
  await c.read('flight:1',1,async()=>{loads++;return {id:1,totalSeats:10};});
  await c.read('flight:1',1,async()=>{loads++;return {};});assert.equal(loads,1);
  pass('Second read is served from Redis without calling the database loader');
  assert.deepEqual(searchKey({minPrice:'2000',departureAirportId:'01',arrivalAirportId:'2'}),searchKey({arrivalAirportId:'2',departureAirportId:'1',minPrice:2000}));
  assert.notDeepEqual(searchKey({departureAirportId:'1',minPrice:'2000'}),searchKey({departureAirportId:'1',minPrice:'3000'}));
  pass('Search keys normalize filter order/types and distinguish different filters');
  const short=await createCache({ttlMs:100});let value=1;
  await short.read('flight:1',1,async()=>value);value=2;await sleep(150);
  assert.equal(await short.read('flight:1',1,async()=>value),2);
  pass('TTL expires stale data even without a successful invalidation');
  let release,started;
  const gate=new Promise(r=>{release=r;});const loading=new Promise(r=>{started=r;});
  const stale=c.read('flight:2',2,async()=>{started();await gate;return {version:'old'};});await loading;
  await c.invalidateFlights({id:2,departureAirportId:1,arrivalAirportId:2});
  release();await stale;
  assert.equal((await c.read('flight:2',2,async()=>({version:'new'}))).version,'new');
  pass('A read started before invalidation cannot repopulate the current cache generation');
  await c.client.del(c.generationKey('flight:1'));
  assert.equal((await c.read('flight:1',1,async()=>({totalSeats:7}))).totalSeats,7);
  pass('Evicting generation metadata cannot resurrect an older cached value');
  let joinedLoads=0;
  await Promise.all(Array.from({length:20},()=>c.read('flight:3',3,async()=>{joinedLoads++;await sleep(80);return {id:3};})));
  assert.equal(joinedLoads,1);pass('Concurrent identical misses share one database load within a process');
  const limited=new FlightCache({url:null,maxDbLoads:1});instances.push(limited);
  let unblock;const blocked=limited.read('a','a',()=>new Promise(r=>{unblock=r;}));await sleep(5);
  await assert.rejects(limited.read('b','b',async()=>1),e=>e.statusCode===503);unblock(1);await blocked;
  pass('Database fallback rejects excess parallel loads instead of building an unbounded queue');
  const start=Date.now();
  assert.equal(await c.command(()=>new Promise(()=>{})),undefined);
  assert.ok(Date.now()-start<1000);pass('A hung Redis command has a bounded deadline');

  const stamp=Date.now();const ids=[];
  for(let i=0;i<3;i++){const city=await db.City.create({name:`Redis-${stamp}-${i}`});const airport=await db.Airport.create({name:'Redis test',cityId:city.id});ids.push(airport.id);}
  const plane=await db.Airplane.create({modelNumber:'Redis test',capacity:10});
  const route=`/api/v1/flights?departureAirportId=${ids[0]}&arrivalAirportId=${ids[1]}`;
  assert.equal((await request(3002,route)).length,0);
  const flight=await request(3002,'/api/v1/flights','POST',{flightNumber:`RC-${stamp}`,airplaneId:plane.id,departureAirportId:ids[0],arrivalAirportId:ids[1],departureTime:'2099-01-01T10:00:00Z',arrivalTime:'2099-01-01T12:00:00Z',price:2500});
  assert.equal((await request(3002,route)).length,1);pass('Creating a flight invalidates a previously cached empty search');
  await request(3002,`/api/v1/flights/${flight.id}`);
  const metrics1=await request(3002,'/api/v1/internal/cache-metrics');
  await request(3002,`/api/v1/flights/${flight.id}`);await request(3002,route);
  const metrics2=await request(3002,'/api/v1/internal/cache-metrics');
  assert.ok(metrics2.hits>=metrics1.hits+2);pass('Both public read endpoints produce verified cache hits');
  const key=crypto.randomUUID();const booking=await request(3003,'/api/v1/booking','POST',{flightId:flight.id,userId:987654,noOfSeats:2},key);
  assert.equal((await request(3002,`/api/v1/flights/${flight.id}`)).totalSeats,8);
  assert.equal((await request(3002,route))[0].totalSeats,8);pass('Committed reservation invalidates detail and matching search availability');
  await request(3003,`/api/v1/booking/${booking.id}/cancel`,'POST',{userId:987654},key);
  assert.equal((await request(3002,route))[0].totalSeats,10);pass('Committed cancellation invalidates cached availability');
  await request(3002,`/api/v1/flights/${flight.id}`,'POST',{arrivalAirportId:ids[2],price:3500});
  assert.equal((await request(3002,route)).length,0);
  const newRoute=`/api/v1/flights?departureAirportId=${ids[0]}&arrivalAirportId=${ids[2]}`;
  assert.equal((await request(3002,newRoute))[0].price,3500);
  assert.equal((await request(3002,`/api/v1/flights/${flight.id}`)).price,3500);pass('Route/price edits invalidate old and new route searches and flight details');
  fs.writeFileSync(path.join(root,'.local/redis-test-fixture.json'),JSON.stringify({flightId:flight.id,route:newRoute}));
  report.passed=true;
}
main().catch(e=>{report.passed=false;report.error=e.stack;process.exitCode=1;console.error(e.message);}).finally(async()=>{
  await Promise.all([...instances,cache].map(c=>c.close()));await db.sequelize.close();
  fs.writeFileSync(path.join(root,'docs/redis-test-results.json'),JSON.stringify(report,null,2)+'\n');
});
