const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const support=require('./rabbitmq-test-support.js');
const {root,bookings,notifications,flights,fixture,request,until}=support;
const rabbit=require(path.join(root,'Booking_Service/src/rabbitmq'));
const stateFile=path.join(root,'.local/rabbitmq-outage.json');
const reportFile=path.join(root,'docs/rabbitmq-outage-results.json');
async function main(){
  if(process.argv[2]==='down'){
    await assert.rejects(rabbit.connect());
    const data=await fixture(),key=crypto.randomUUID();
    const booking=await request('/booking',data,key);
    assert.equal(booking.status,'Booked');
    const outbox=await bookings.BookingOutbox.findByPk(`booking.confirmed:${booking.id}`);
    assert.ok(outbox);assert.equal(outbox.publishedAt,null);
    assert.equal((await flights.Flight.findByPk(data.flightId)).totalSeats,29);
    fs.writeFileSync(stateFile,JSON.stringify({data,key,bookingId:booking.id}));
    fs.writeFileSync(reportFile,JSON.stringify({timestamp:new Date().toISOString(),bookingId:booking.id,bookedWhileBrokerDown:true,eventPending:true,passed:false},null,2)+'\n');
    console.log('PASS: broker unavailable; booking confirmed once and event remains in the outbox');
  }else if(process.argv[2]==='restored'){
    const state=JSON.parse(fs.readFileSync(stateFile));
    const eventId=`booking.confirmed:${state.bookingId}`;
    await until(async()=>(await bookings.BookingOutbox.findByPk(eventId))?.publishedAt,30000);
    await until(async()=>(await notifications.BookingNotification.findByPk(eventId))?.status===support.deliveryStatus,30000);
    assert.equal(await notifications.BookingNotification.count({where:{eventId}}),1);
    await request(`/booking/${state.bookingId}/cancel`,{userId:state.data.userId},state.key);
    assert.equal((await flights.Flight.findByPk(state.data.flightId)).totalSeats,30);
    const report=JSON.parse(fs.readFileSync(reportFile));
    Object.assign(report,{restoredAt:new Date().toISOString(),eventDeliveredAfterRecovery:true,notificationCount:1,seatsRestored:true,passed:true});
    fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n');
    console.log('PASS: broker recovery publishes the pending event once logically; cancellation restores inventory');
  }else throw new Error('Usage: verify-rabbitmq-outage.js down|restored');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(support.close);
