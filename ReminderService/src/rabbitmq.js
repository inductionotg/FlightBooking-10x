'use strict';
// Copied into booking and notification repositories by scripts/sync-rabbitmq.cjs.
const amqp=require('amqplib');
const topology={exchange:'booking.events',key:'booking.confirmed.v1',queue:'notifications.booking-confirmed.v1',dead:'booking.events.dead'};
async function connect(){
  const connection=await amqp.connect(process.env.RABBITMQ_URL,{timeout:3000});
  connection.on('error',()=>{});
  const channel=await connection.createConfirmChannel();
  channel.on('error',()=>{});
  channel.on('close',()=>{connection.close().catch(()=>{});});
  try{
    await channel.assertExchange(topology.exchange,'direct',{durable:true});
    await channel.assertExchange(topology.dead,'direct',{durable:true});
    await channel.assertQueue(topology.queue,{durable:true,arguments:{'x-queue-type':'quorum','x-delivery-limit':-1}});
    await channel.bindQueue(topology.queue,topology.exchange,topology.key);
    await channel.assertQueue(topology.queue+'.dead',{durable:true,arguments:{'x-queue-type':'quorum'}});
    await channel.bindQueue(topology.queue+'.dead',topology.dead,topology.key);
    await channel.assertQueue(topology.queue+'.retry',{durable:true,arguments:{
      'x-queue-type':'quorum','x-message-ttl':5000,'x-dead-letter-exchange':topology.exchange,
      'x-dead-letter-routing-key':topology.key,'x-dead-letter-strategy':'at-least-once','x-overflow':'reject-publish'
    }});
    return {connection,channel};
  }catch(error){await connection.close().catch(()=>{});throw error;}
}
function publish(channel,exchange,key,content,options={}){
  return new Promise((resolve,reject)=>{
    let returned=false;
    const onReturn=message=>{if(message.properties.messageId===options.messageId)returned=true;};
    channel.on('return',onReturn);
    const timer=setTimeout(()=>{cleanup();reject(new Error('Publisher confirm timeout'));},3000);
    function cleanup(){clearTimeout(timer);channel.removeListener('return',onReturn);}
    try{
      channel.publish(exchange,key,content,{...options,persistent:true,mandatory:true,contentType:'application/json'},error=>{
        cleanup();if(error||returned)reject(error||new Error('Unroutable event'));else resolve();
      });
    }catch(error){cleanup();reject(error);}
  });
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
module.exports={connect,publish,topology,sleep};
