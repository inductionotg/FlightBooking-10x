const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const root = path.resolve(__dirname, '..');
require(path.join(root, 'Booking_Service/node_modules/dotenv')).config({path:path.join(root, 'Booking_Service/.env')});
for (const [dir,name] of [['Booking_Service','baseline_booking'],['FlightandSearchService','baseline_flights']]) {
  const config=require(path.join(root,dir,'src/config/config.json')).development;
  assert.equal(config.database,name);assert.equal(config.host,'127.0.0.1');assert.equal(config.port,33306);
}
const flightDb = require(path.join(root,'FlightandSearchService/src/models'));
const bookingDb = require(path.join(root,'Booking_Service/src/models'));
flightDb.sequelize.options.logging=false;bookingDb.sequelize.options.logging=false;
const BookingService = require(path.join(root,'Booking_Service/src/services/booking-service'));
const reservationService = require(path.join(root,'FlightandSearchService/src/services/reservation-service'));
const axios = require(path.join(root,'Booking_Service/node_modules/axios/dist/node/axios.cjs'));
const normal = new BookingService();
const report={timestamp:new Date().toISOString(),checks:[],flights:[]};
function passed(name){report.checks.push({name,passed:true});console.log(`PASS: ${name}`);}
const hash = (user,key) => crypto.createHash('sha256').update(`${user}\0${key}`).digest('hex');
const userId=987654; // Synthetic user; original booking domain has no cross-DB user FK.
async function newFlight(seats=1){
  const flight=await flightDb.Flight.create({flightNumber:`TX-${crypto.randomUUID()}`,airplaneId:1,
    departureAirportId:1,arrivalAirportId:2,departureTime:'2099-01-01T10:00:00Z',arrivalTime:'2099-01-01T12:00:00Z',price:2500,totalSeats:seats});
  report.flights.push(flight.id);return flight;
}
const seats = async id => (await flightDb.Flight.findByPk(id)).totalSeats;
async function post(port, route, data, key, extra={}){
  const response=await fetch(`http://[::1]:${port}${route}`,{method:'POST',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{}),...extra},body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});
  return {status:response.status,body:await response.json(),key:response.headers.get('Idempotency-Key')};
}
async function waitFor(id,predicate){
  const until=Date.now()+20000;
  while(Date.now()<until){const row=await bookingDb.Booking.findByPk(id);if(predicate(row))return row;await new Promise(r=>setTimeout(r,250));}
  throw new Error(`Recovery deadline exceeded for booking ${id}`);
}
async function main(){
  let flight=await newFlight();
  const competing=await Promise.all(Array.from({length:20},()=>post(3003,'/api/v1/booking',{flightId:flight.id,userId,noOfSeats:1},crypto.randomUUID())));
  assert.equal(competing.filter(r=>r.status===200).length,1);
  assert.equal(competing.filter(r=>r.status===409&&r.body.code==='INSUFFICIENT_SEATS').length,19);
  assert.equal(await seats(flight.id),0);
  assert.equal(await bookingDb.Booking.count({where:{flightId:flight.id,status:'Booked'}}),1);
  passed('20 concurrent requests for one seat: 1 booked, 19 rejected, zero seats left');

  flight=await newFlight(5);let key=crypto.randomUUID();
  const duplicates=await Promise.all(Array.from({length:20},()=>post(3003,'/api/v1/booking',{flightId:flight.id,userId,noOfSeats:2},key)));
  assert.ok(duplicates.every(r=>r.status===200));
  assert.equal(new Set(duplicates.map(r=>r.body.data.id)).size,1);
  assert.equal(await seats(flight.id),3);
  const booked=duplicates[0].body.data;
  assert.equal(await flightDb.Reservation.count({where:{bookingId:booked.id}}),1);
  passed('20 simultaneous retries with one key create one booking and deduct seats once');
  assert.equal((await post(3003,'/api/v1/booking',{flightId:flight.id,userId,noOfSeats:3},key)).status,409);
  passed('Reusing a key with a different payload returns conflict');
  assert.equal((await post(3002,`/api/v1/flights/${flight.id}`,{totalSeats:999})).status,409);
  assert.equal(await seats(flight.id),3);
  passed('Legacy inventory overwrite cannot bypass active reservations');
  await flight.update({price:3500});
  assert.equal((await post(3003,'/api/v1/booking',{flightId:flight.id,userId,noOfSeats:2},key)).body.data.totalCost,5000);
  passed('Retry preserves the original price snapshot');
  assert.equal((await post(3003,`/api/v1/booking/${booked.id}/cancel`,{userId},'wrong-key')).status,404);
  const cancelled=await Promise.all(Array.from({length:5},()=>post(3003,`/api/v1/booking/${booked.id}/cancel`,{userId},key)));
  assert.ok(cancelled.every(r=>r.status===200));assert.equal(await seats(flight.id),5);
  assert.equal((await post(3003,'/api/v1/booking',{flightId:flight.id,userId,noOfSeats:2},key)).status,409);
  passed('Cancellation requires the original key; repeated releases restore seats exactly once');

  flight=await newFlight(2);
  const rollbackBooking=await bookingDb.Booking.create({flightId:flight.id,userId,noOfSeats:1});
  const originalCreate=flightDb.Reservation.create;
  flightDb.Reservation.create=async()=>{throw new Error('Injected reservation insert failure');};
  try{await assert.rejects(reservationService.reserve({bookingId:rollbackBooking.id,flightId:flight.id,noOfSeats:1}),/Injected/);}
  finally{flightDb.Reservation.create=originalCreate;}
  assert.equal(await seats(flight.id),2);assert.equal(await flightDb.Reservation.findByPk(rollbackBooking.id),null);
  passed('Reservation insert failure rolls back the seat deduction');

  flight=await newFlight(2);key=crypto.randomUUID();
  const lostReply=new BookingService({flightClient:{post:async(...args)=>{await axios.post(...args);throw new Error('Injected lost reply');}}});
  const uncertain=await lostReply.createBooking({flightId:flight.id,userId,noOfSeats:1},key);
  assert.equal(uncertain.status,'InProcess');assert.equal(await seats(flight.id),1);
  const recovered=await normal.reconcile(uncertain.id);
  assert.equal(recovered.status,'Booked');assert.equal(await seats(flight.id),1);
  passed('Lost reservation reply leaves pending state; retry confirms without another deduction');

  flight=await newFlight(2);key=crypto.randomUUID();
  const exitCode=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(__dirname,'booking-crash-fixture.js'),JSON.stringify({data:{flightId:flight.id,userId,noOfSeats:1},key})],{stdio:'ignore'});
    child.once('error',reject);child.once('close',resolve);
  });
  assert.equal(exitCode,86);
  const crashed=await bookingDb.Booking.findOne({where:{requestKey:hash(userId,key)}});
  assert.ok(crashed);
  await waitFor(crashed.id,row=>row.status==='Booked');assert.equal(await seats(flight.id),1);
  passed('Process exit after reservation commit is recovered by the running background worker');

  flight=await newFlight(2);key=crypto.randomUUID();
  const pending=await new BookingService({flightClient:{post:async()=>{throw new Error('Flight unavailable');}}}).createBooking({flightId:flight.id,userId,noOfSeats:1},key);
  assert.equal(pending.status,'InProcess');
  await waitFor(pending.id,row=>row.status==='Booked');assert.equal(await seats(flight.id),1);
  passed('Temporary flight-service failure is recovered automatically');

  flight=await newFlight(2);key=crypto.randomUUID();
  const toCancel=await normal.createBooking({flightId:flight.id,userId,noOfSeats:1},key);
  const releaseFailure=new BookingService({flightClient:{post:async()=>{throw new Error('Release unavailable');}}});
  const awaitingRelease=await releaseFailure.cancelBooking(toCancel.id,userId,key);
  assert.equal(awaitingRelease.status,'Cancelled');assert.equal(awaitingRelease.reservationReleased,false);
  await waitFor(toCancel.id,row=>row.reservationReleased);assert.equal(await seats(flight.id),2);
  passed('Failed cancellation release is durably retried by the worker');

  flight=await newFlight(2);key=crypto.randomUUID();
  let letReserveProceed, signalReserve;
  const gate=new Promise(resolve=>{letReserveProceed=resolve;});
  const started=new Promise(resolve=>{signalReserve=resolve;});
  const delayed=new BookingService({flightClient:{post:async(...args)=>{signalReserve();await gate;return axios.post(...args);}}});
  const inflight=delayed.createBooking({flightId:flight.id,userId,noOfSeats:1},key);
  await started;
  const racing=await bookingDb.Booking.findOne({where:{requestKey:hash(userId,key)}});
  try{await normal.cancelBooking(racing.id,userId,key);}finally{letReserveProceed();}
  assert.equal((await inflight).status,'Cancelled');assert.equal(await seats(flight.id),2);
  assert.equal((await flightDb.Reservation.findByPk(racing.id)).status,'Released');
  passed('Cancellation before a delayed reserve prevents later deduction');

  for(const noOfSeats of [0,-1,1.5]) assert.equal((await post(3003,'/api/v1/booking',{flightId:flight.id,userId,noOfSeats},crypto.randomUUID())).status,400);
  assert.equal((await post(3002,'/api/v1/reservations',{bookingId:1,flightId:flight.id,noOfSeats:1})).status,401);
  passed('Invalid seat counts and unauthenticated internal reservation calls are rejected');
  report.passed=true;
}
main().catch(error=>{report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error.message);}).finally(async()=>{
  await Promise.all([flightDb.sequelize.close(),bookingDb.sequelize.close()]);
  fs.writeFileSync(path.join(root,'docs/reservation-test-results.json'),JSON.stringify(report,null,2)+'\n');
});
