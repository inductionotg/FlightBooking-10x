const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const support=require('./rabbitmq-test-support.js');
const {root,bookings,notifications,flights,fixture,request,until}=support;
const rabbit=require(path.join(root,'Booking_Service/src/rabbitmq'));
const {handle,persist}=require(path.join(root,'ReminderService/src/services/booking-consumer'));
const report={timestamp:new Date().toISOString(),checks:[]};let connection,channel;
const pass=name=>{report.checks.push({name,passed:true});console.log('PASS: '+name);};
async function main(){
  ({connection,channel}=await rabbit.connect());
  const data=await fixture(),key=crypto.randomUUID(),traceId=crypto.randomBytes(16).toString('hex');
  const booking=await request('/booking',data,key,traceId);
  const eventId=`booking.confirmed:${booking.id}`;
  const outbox=await bookings.BookingOutbox.findByPk(eventId);assert.ok(outbox);assert.equal(outbox.payload.bookingId,booking.id);
  pass('Booking confirmation durably creates its outbox event');
  const received=await until(async()=>{const row=await notifications.BookingNotification.findByPk(eventId);return row?.status===support.deliveryStatus&&row;});
  await until(async()=>(await outbox.reload()).publishedAt);
  assert.ok(received.traceParent.includes(traceId));
  pass(`Confirmed publish reaches notifications, preserves the trace and completes as ${support.deliveryStatus}`);
  if(support.deliveryStatus==='Sent'){
    await until(async()=>{
      const response=await fetch('http://127.0.0.1:38025/api/v1/messages');
      assert.equal(response.status,200);
      const inbox=await response.json();
      return inbox.messages?.some(message=>message.Subject===`Booking ${booking.id} confirmed`&&
        message.To?.some(recipient=>recipient.Address===data.notificationEmail));
    });
    pass('Local SMTP inbox contains the booking confirmation addressed to the requested recipient');
  }
  await Promise.all(Array.from({length:8},()=>request('/booking',data,key)));
  assert.equal(await bookings.BookingOutbox.count({where:{bookingId:booking.id}}),1);
  pass('Concurrent idempotent booking retries create one outbox event');
  await rabbit.publish(channel,rabbit.topology.exchange,rabbit.topology.key,Buffer.from(JSON.stringify(outbox.payload)),{messageId:eventId,headers:{traceparent:outbox.traceParent}});
  await new Promise(r=>setTimeout(r,500));
  assert.equal(await notifications.BookingNotification.count({where:{bookingId:booking.id}}),1);
  // Simulate process death after durable persistence but before acknowledgement.
  await persist(Buffer.from(JSON.stringify(outbox.payload)),outbox.traceParent);
  assert.equal(await notifications.BookingNotification.count({where:{bookingId:booking.id}}),1);
  pass('Broker redelivery and repeat processing do not duplicate durable notifications');
  const suffix=crypto.randomUUID();
  const dead=`verify.dead.${suffix}`,watch=`verify.retry.${suffix}`,source=`verify.source.${suffix}`;
  for(const queue of [dead,watch,source])await channel.assertQueue(queue,{exclusive:true,autoDelete:true});
  await channel.bindQueue(dead,rabbit.topology.dead,rabbit.topology.key);
  await channel.bindQueue(watch,rabbit.topology.exchange,rabbit.topology.key);
  await rabbit.publish(channel,rabbit.topology.exchange,rabbit.topology.key,Buffer.from('{broken'),{messageId:suffix});
  const malformed=await until(async()=>{const m=await channel.get(dead);if(m){channel.ack(m);return m.properties.messageId===suffix&&m;}return false;});
  assert.ok(malformed);pass('Malformed events are routed to the durable dead-letter queue');
  // Drive the same consumer handler with a transient DB failure on an isolated input queue.
  await rabbit.publish(channel,'',source,Buffer.from(JSON.stringify(outbox.payload)),{messageId:eventId,headers:{retryCount:0}});
  const message=await channel.get(source);assert.ok(message);
  await handle(channel,message,async()=>{throw new Error('Simulated DB outage');});
  const retried=await until(async()=>{const m=await channel.get(watch);if(m){channel.ack(m);return m.properties.headers?.retryCount===1&&m;}return false;});
  assert.ok(retried);pass('Transient consumer failure uses a confirmed delayed retry');
  await rabbit.publish(channel,'',source,Buffer.from(JSON.stringify(outbox.payload)),{messageId:eventId,headers:{retryCount:3}});
  await handle(channel,await channel.get(source),async()=>{throw new Error('Simulated persistent DB outage');});
  const exhausted=await until(async()=>{const m=await channel.get(dead);if(m){channel.ack(m);return m.properties.headers?.retryCount===4&&m;}return false;});
  assert.ok(exhausted);pass('Exhausted consumer retries reach the dead-letter queue');
  const BookingService=require(path.join(root,'Booking_Service/src/services/booking-service'));
  const atomicData=await fixture(),atomicKey=crypto.randomUUID(),service=new BookingService();
  const original=bookings.BookingOutbox.create;let pending;
  try{bookings.BookingOutbox.create=async()=>{throw new Error('Simulated outbox insert failure');};pending=await service.createBooking(atomicData,atomicKey);assert.equal(pending.status,'InProcess');assert.equal(await bookings.BookingOutbox.count({where:{bookingId:pending.id}}),0);}
  finally{bookings.BookingOutbox.create=original;}
  const recovered=await service.reconcile(pending.id);assert.equal(recovered.status,'Booked');
  assert.equal((await flights.Flight.findByPk(atomicData.flightId)).totalSeats,29);
  pass('Outbox insert failure rolls back confirmation; retry reuses the reservation without another seat deduction');
  const noEmail=await fixture();delete noEmail.notificationEmail;
  const legacyKey=crypto.randomUUID(),legacy=await request('/booking',noEmail,legacyKey);
  await until(async()=>(await notifications.BookingNotification.findByPk(`booking.confirmed:${legacy.id}`))?.status==='NeedsRecipient');
  pass('Existing booking requests without email remain compatible and require a recipient');
  for(const [row,payload,k] of [[booking,data,key],[recovered,atomicData,atomicKey],[legacy,noEmail,legacyKey]])await request(`/booking/${row.id}/cancel`,{userId:payload.userId},k);
  report.bookingIds=[booking.id,recovered.id,legacy.id];report.traceId=traceId;report.passed=true;
}
main().catch(error=>{report.passed=false;report.error=error.stack;process.exitCode=1;console.error(error.message);}).finally(async()=>{
  if(connection)await connection.close().catch(()=>{});await support.close();fs.writeFileSync(path.join(root,'docs/rabbitmq-test-results.json'),JSON.stringify(report,null,2)+'\n');
});
