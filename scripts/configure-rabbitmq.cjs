const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const dotenv=require(path.join(root,'Booking_Service/node_modules/dotenv'));
const file=path.join(root,'.local/rabbitmq.env');
fs.mkdirSync(path.dirname(file),{recursive:true});
if(!fs.existsSync(file))fs.writeFileSync(file,`RABBITMQ_DEFAULT_USER=flightlocal\nRABBITMQ_DEFAULT_PASS=${crypto.randomBytes(24).toString('hex')}\nRABBITMQ_DEFAULT_VHOST=flight-booking\n`);
const env=dotenv.parse(fs.readFileSync(file));
const url=`amqp://${encodeURIComponent(env.RABBITMQ_DEFAULT_USER)}:${encodeURIComponent(env.RABBITMQ_DEFAULT_PASS)}@127.0.0.1:35672/${encodeURIComponent(env.RABBITMQ_DEFAULT_VHOST)}?heartbeat=10`;
for(const dir of ['Booking_Service','ReminderService']){
  const target=path.join(root,dir,'.env'),current=dotenv.parse(fs.readFileSync(target));
  if(!current.RABBITMQ_URL)fs.appendFileSync(target,`\nRABBITMQ_URL=${url}\n`);
  if(dir==='ReminderService'&&!current.NOTIFICATION_DELIVERY_MODE)fs.appendFileSync(target,'NOTIFICATION_DELIVERY_MODE=dry-run\n');
}
console.log('Local RabbitMQ credentials configured without printing secrets. Existing configuration preserved.');
