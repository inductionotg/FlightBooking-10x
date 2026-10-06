const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
require(path.join(root,'Booking_Service/node_modules/dotenv')).config({path:path.join(root,'Booking_Service/.env')});
const dotenv=require(path.join(root,'Booking_Service/node_modules/dotenv'));
const mail=dotenv.parse(fs.readFileSync(path.join(root,'ReminderService/.env')));
assert.ok(['dry-run','smtp'].includes(mail.NOTIFICATION_DELIVERY_MODE));
if(mail.NOTIFICATION_DELIVERY_MODE==='smtp'){
  assert.equal(mail.SMTP_HOST,'127.0.0.1','Tests must use the local SMTP catcher');
  assert.equal(mail.SMTP_PORT,'31025','Tests must use the local SMTP catcher');
}
const dirs=['Booking_Service','ReminderService','FlightandSearchService'];
for(const dir of dirs){const c=require(path.join(root,dir,'src/config/config.json')).development;assert.equal(c.host,'127.0.0.1');assert.equal(c.port,33306);assert.ok(c.database.startsWith('baseline_'));}
const [bookings,notifications,flights]=dirs.map(dir=>require(path.join(root,dir,'src/models')));
const {signIn}=require('./local-auth');
async function fixture(){
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'.local/k6-catalog.json')));
  const flight=await flights.Flight.create({...catalog.routes[0],airplaneId:catalog.airplaneId,flightNumber:`MQ-${crypto.randomUUID()}`,price:2500,totalSeats:30,departureTime:'2099-01-01T10:00:00Z',arrivalTime:'2099-01-01T12:00:00Z'});
  return {flightId:flight.id,userId:catalog.userId,noOfSeats:1,notificationEmail:`mq-${crypto.randomUUID()}@example.test`};
}
async function request(route,data,key,traceId){
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'.local/k6-catalog.json')));
  const token=await signIn(catalog.email,catalog.password);
  const response=await fetch(`http://[::1]:3003/api/v1${route}`,{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':key,'x-access-token':token,...(traceId?{traceparent:`00-${traceId}-1234567890abcdef-01`}:{})},body:JSON.stringify(data),signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,200);return (await response.json()).data;
}
async function until(check,ms=20000){const end=Date.now()+ms;do{const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,200));}while(Date.now()<end);throw new Error('Timed out waiting for asynchronous processing');}
async function close(){await Promise.all([bookings,notifications,flights].map(db=>db.sequelize.close()));}
module.exports={root,bookings,notifications,flights,fixture,request,until,close,deliveryStatus:mail.NOTIFICATION_DELIVERY_MODE==='smtp'?'Sent':'DryRun'};
