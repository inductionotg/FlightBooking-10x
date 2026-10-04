// Configure only existing local service .env files; never print the access key.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname,'..');
const dotenv = require(path.join(root,'Auth_Service/node_modules/dotenv'));
const services = ['Auth_Service','Booking_Service','FlightandSearchService','ReminderService','AIRLINE-MANAGEMENT_API_GATEWAY'];
const files = services.map(dir=>path.join(root,dir,'.env'));
const texts = files.map(file=>fs.readFileSync(file,'utf8'));
const key = crypto.randomBytes(32).toString('hex');
files.forEach((file,i)=>{
  if(!dotenv.parse(texts[i]).OBSERVABILITY_KEY)fs.appendFileSync(file,`\nOBSERVABILITY_KEY=${key}\n`);
});
console.log('Metrics access configured for local services. Existing keys preserved; restart services to apply.');
