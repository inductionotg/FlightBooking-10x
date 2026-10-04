const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const services = {auth:['Auth_Service',3001],booking:['Booking_Service',3003],flights:['FlightandSearchService',3002],notifications:['ReminderService',3004],gateway:['AIRLINE-MANAGEMENT_API_GATEWAY',3010]};
async function main(){
  const selected = services[process.argv[2]];
  if(!selected)throw new Error('Usage: node scripts/read-metrics.js auth|booking|flights|notifications|gateway');
  const dotenv = require(path.join(root,'Auth_Service/node_modules/dotenv'));
  const key = dotenv.parse(fs.readFileSync(path.join(root,selected[0],'.env'))).OBSERVABILITY_KEY;
  const response = await fetch(`http://[::1]:${selected[1]}/internal/metrics`,{headers:{'x-observability-key':key || ''},signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error(`Metrics request returned HTTP ${response.status}`);
  process.stdout.write(await response.text());
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
