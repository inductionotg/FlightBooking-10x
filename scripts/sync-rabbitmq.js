const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
for(const dir of ['Booking_Service','ReminderService'])fs.copyFileSync(path.join(root,'messaging/rabbitmq.js'),path.join(root,dir,'src/rabbitmq.js'));
console.log('RabbitMQ helper copied into both standalone services.');
