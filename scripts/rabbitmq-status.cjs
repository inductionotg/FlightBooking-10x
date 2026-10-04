const path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..');
const dotenv=require(path.join(root,'Booking_Service/node_modules/dotenv'));
const env=dotenv.parse(fs.readFileSync(path.join(root,'.local/rabbitmq.env')));
async function main(){
  const response=await fetch(`http://127.0.0.1:35673/api/queues/${encodeURIComponent(env.RABBITMQ_DEFAULT_VHOST)}`,{
    headers:{authorization:'Basic '+Buffer.from(`${env.RABBITMQ_DEFAULT_USER}:${env.RABBITMQ_DEFAULT_PASS}`).toString('base64')},signal:AbortSignal.timeout(5000)
  });
  if(!response.ok)throw new Error(`Queue status: HTTP ${response.status}`);
  console.log(JSON.stringify((await response.json()).filter(q=>q.name.startsWith('notifications.')).map(q=>({queue:q.name,type:q.type,ready:q.messages_ready,unacknowledged:q.messages_unacknowledged,consumers:q.consumers})),null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
