const crypto=require('node:crypto');
const {Op}=require('sequelize');
const {BookingNotification,sequelize}=require('../models');
const telemetry=require('../observability');
const {sleep}=require('../rabbitmq');
async function deliverOne(send,mode=process.env.NOTIFICATION_DELIVERY_MODE||'dry-run'){
  if(!['dry-run','smtp'].includes(mode))throw new Error('Invalid NOTIFICATION_DELIVERY_MODE');
  const notification=await sequelize.transaction(async transaction=>{
    const row=await BookingNotification.findOne({where:{availableAt:{[Op.lte]:new Date()},[Op.or]:[
      {status:'Pending'},{status:'Sending',leaseUntil:{[Op.lte]:new Date()}}
    ]},order:[['availableAt','ASC']],transaction,lock:transaction.LOCK.UPDATE,skipLocked:true});
    if(!row)return null;
    await row.update({status:'Sending',attempts:row.attempts+1,leaseToken:crypto.randomUUID(),leaseUntil:new Date(Date.now()+60000)},{transaction});
    return row.toJSON();
  });
  if(!notification)return false;
  return telemetry.context.run(telemetry.trace(notification.traceParent),async()=>{
    let status;
    try{
      if(mode==='smtp'){
        if(!send){
          send=message=>require('../config/email-config').sendMail(message);
        }
        const event=notification.payload;
        await send({to:event.notificationEmail,subject:`Booking ${event.bookingId} confirmed`,
          text:`Booking ${event.bookingId} for flight ${event.flightId} was confirmed for ${event.noOfSeats} seat(s). Total: ${event.totalCost}.`,
          messageId:`<${event.eventId.replace(':','-')}@flight-booking.local>`});
        status='Sent';
      }else status='DryRun';
      await BookingNotification.update({status,leaseUntil:null,leaseToken:null},{where:{eventId:notification.eventId,leaseToken:notification.leaseToken}});
      telemetry.add('booking_notification_deliveries_total',{outcome:status});
      telemetry.log('notification.delivery',{bookingId:notification.bookingId,outcome:status});
    }catch(error){
      await BookingNotification.update({status:notification.attempts>=5?'Failed':'Pending',availableAt:new Date(Date.now()+Math.min(60000,2000*2**notification.attempts)),leaseUntil:null,leaseToken:null},
        {where:{eventId:notification.eventId,leaseToken:notification.leaseToken}});
      telemetry.add('booking_notification_deliveries_total',{outcome:'error'});
      telemetry.log('notification.delivery_failed',{bookingId:notification.bookingId,errorType:error.name},'error');
    }
    return true;
  });
}
function startDelivery(){
  if(!process.env.RABBITMQ_URL)return;
  let stopped=false;
  (async()=>{
    while(!stopped){
      try{if(!await deliverOne())await sleep(1000);}
      catch(error){telemetry.log('notification.delivery_worker_failed',{errorType:error.name},'error');await sleep(2000);}
    }
  })();
  return ()=>{stopped=true;};
}
module.exports={deliverOne,startDelivery};
