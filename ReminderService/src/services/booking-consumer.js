const {BookingNotification}=require('../models');
const rabbit=require('../rabbitmq');
const telemetry=require('../observability');
const permanent=()=>Object.assign(new Error('Invalid booking event'),{permanent:true});
function validate(content){
  if(content.length>16384)throw permanent();
  let event;try{event=JSON.parse(content.toString());}catch(_){throw permanent();}
  if(!event||event.type!=='booking.confirmed.v1')throw permanent();
  for(const field of ['bookingId','flightId','userId','noOfSeats'])if(!Number.isSafeInteger(event[field])||event[field]<=0||event[field]>2147483647)throw permanent();
  if(event.eventId!==`booking.confirmed:${event.bookingId}`||!Number.isSafeInteger(event.totalCost)||event.totalCost<0||event.totalCost>2147483647)throw permanent();
  if(event.notificationEmail!==null&&(typeof event.notificationEmail!=='string'||event.notificationEmail.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(event.notificationEmail)))throw permanent();
  return {eventId:event.eventId,type:event.type,bookingId:event.bookingId,flightId:event.flightId,userId:event.userId,noOfSeats:event.noOfSeats,totalCost:event.totalCost,notificationEmail:event.notificationEmail};
}
async function persist(content,traceParent){
  const event=validate(content);
  try{
    await BookingNotification.create({eventId:event.eventId,bookingId:event.bookingId,payload:event,traceParent,
      status:event.notificationEmail?'Pending':'NeedsRecipient',availableAt:new Date()});
    telemetry.add('booking_notifications_total',{outcome:'accepted'});
  }catch(error){
    if(error.name!=='SequelizeUniqueConstraintError')throw error;
    const prior=await BookingNotification.findByPk(event.eventId);
    if(!prior||JSON.stringify(validate(Buffer.from(JSON.stringify(prior.payload))))!==JSON.stringify(event))throw permanent();
    telemetry.add('booking_notifications_total',{outcome:'duplicate'});
  }
  telemetry.log('notification.event_received',{bookingId:event.bookingId});
  return event;
}
async function handle(channel,message,store=persist){
  if(!message)throw new Error('Consumer cancelled');
  return telemetry.context.run(telemetry.trace(message.properties.headers?.traceparent),async()=>{
    try{
      await store(message.content,telemetry.headers().traceparent);
      channel.ack(message); // The durable inbox owns delivery from this point onward.
    }catch(error){
      const retries=Number(message.properties.headers?.retryCount)||0;
      const dead=error.permanent||retries>=3;
      await rabbit.publish(channel,dead?rabbit.topology.dead:'',dead?rabbit.topology.key:rabbit.topology.queue+'.retry',message.content,{
        messageId:message.properties.messageId,headers:{...message.properties.headers,retryCount:retries+1}
      });
      channel.ack(message); // Ack only after the retry/dead-letter copy is confirmed.
      telemetry.add('booking_notifications_total',{outcome:dead?'dead_letter':'retry'});
      telemetry.log('notification.event_failed',{outcome:dead?'dead_letter':'retry',errorType:error.name},'error');
    }
  });
}
function startConsumer(){
  if(!process.env.RABBITMQ_URL)return;
  let stopped=false,client;
  (async()=>{
    while(!stopped){
      try{
        client=await rabbit.connect();const current=client;
        const closed=new Promise(resolve=>current.connection.once('close',resolve));
        await current.channel.prefetch(5);
        await current.channel.consume(rabbit.topology.queue,message=>{
          handle(current.channel,message).catch(async error=>{
            telemetry.log('notification.consumer_failed',{errorType:error.name},'error');
            await current.connection.close().catch(()=>{}); // Unacked deliveries are requeued.
          });
        },{noAck:false});
        await closed;
      }catch(error){telemetry.log('notification.connection_failed',{errorType:error.name},'error');}
      finally {if(client)await client.connection.close().catch(()=>{});client=null;}
      if(!stopped)await rabbit.sleep(2000);
    }
  })().catch(error=>telemetry.log('notification.consumer_stopped',{errorType:error.name},'error'));
  return async()=>{stopped=true;if(client)await client.connection.close().catch(()=>{});};
}
module.exports={validate,persist,handle,startConsumer};
