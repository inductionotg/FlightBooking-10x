// Restrict the local demonstration to the Docker mail catcher.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const file=path.join(root,'ReminderService/.env');
if(!fs.existsSync(file))throw new Error('Run the local setup first');
const dotenv=require(path.join(root,'ReminderService/node_modules/dotenv'));
const current=dotenv.parse(fs.readFileSync(file));
for(const [key,value] of Object.entries({SMTP_HOST:'127.0.0.1',SMTP_PORT:'31025',SMTP_FROM:'flight-booking@example.test'})){
  if(current[key] && current[key]!==value)throw new Error(`${key} already points elsewhere; refusing to overwrite`);
  if(!current[key])fs.appendFileSync(file,`\n${key}=${value}\n`);
}
if(current.NOTIFICATION_DELIVERY_MODE && !['dry-run','smtp'].includes(current.NOTIFICATION_DELIVERY_MODE))throw new Error('Unknown delivery mode');
const updated=fs.readFileSync(file,'utf8');
if(current.NOTIFICATION_DELIVERY_MODE==='dry-run')fs.writeFileSync(file,updated.replace(/^NOTIFICATION_DELIVERY_MODE=dry-run\s*$/m,'NOTIFICATION_DELIVERY_MODE=smtp'));
else if(!current.NOTIFICATION_DELIVERY_MODE)fs.appendFileSync(file,'\nNOTIFICATION_DELIVERY_MODE=smtp\n');
console.log('Local SMTP catcher configured; restart notifications to activate it.');
