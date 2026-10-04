const {BookingOutbox,sequelize}=require('../models');
const rabbit=require('../rabbitmq');
const telemetry=require('../observability');
async function publishOne(channel){
  return sequelize.transaction(async transaction=>{
    // Only lock the outbox row; booking requests never wait on this network operation.
    const event=await BookingOutbox.findOne({where:{publishedAt:null},order:[['createdAt','ASC']],transaction,lock:transaction.LOCK.UPDATE,skipLocked:true});
    if(!event)return false;
    await telemetry.context.run(telemetry.trace(event.traceParent),()=>telemetry.span('rabbitmq','publish',async headers=>{
      await rabbit.publish(channel,rabbit.topology.exchange,rabbit.topology.key,Buffer.from(JSON.stringify(event.payload)),{
        messageId:event.eventId,headers
      });
      await event.update({publishedAt:new Date()},{transaction});
      telemetry.log('booking.event_published',{bookingId:event.bookingId});
      telemetry.add('booking_events_total',{outcome:'published'});
    }));
    return true;
  });
}
function startPublisher(){
  if(!process.env.RABBITMQ_URL)return;
  let stopped=false,client;
  (async()=>{
    while(!stopped){
      try{
        if(!client){client=await rabbit.connect();const current=client;current.connection.on('close',()=>{if(client===current)client=null;});}
        if(!await publishOne(client.channel))await rabbit.sleep(1000);
      }catch(error){
        telemetry.add('booking_events_total',{outcome:'publish_error'});
        telemetry.log('booking.publish_failed',{errorType:error.name},'error');
        const previous=client;client=null;if(previous)await previous.connection.close().catch(()=>{});
        await rabbit.sleep(2000);
      }
    }
  })().catch(error=>telemetry.log('booking.publisher_stopped',{errorType:error.name},'error'));
  return async()=>{stopped=true;if(client)await client.connection.close().catch(()=>{});};
}
module.exports={publishOne,startPublisher};
