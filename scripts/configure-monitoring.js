const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const dotenv = require(path.join(root,'Auth_Service/node_modules/dotenv'));
const services = [['Auth_Service','auth',13001],['FlightandSearchService','flights',13002],['Booking_Service','booking',13003],['ReminderService','notifications',13004],['AIRLINE-MANAGEMENT_API_GATEWAY','gateway',13010]];
const folder = path.join(root,'.local/monitoring');
const configs = services.map(([dir,name,defaultPort])=>{
  const file=path.join(root,dir,'.env');const env=dotenv.parse(fs.readFileSync(file));
  assert.ok(env.OBSERVABILITY_KEY,`${dir}: configure observability first`);
  const port=Number(env.METRICS_PORT || defaultPort);
  assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535,'Invalid metrics port');
  return {dir,name,file,env,port};
});
assert.equal(new Set(configs.map(c=>c.port)).size,configs.length,'Metrics ports must be distinct');
fs.mkdirSync(path.join(folder,'secrets'),{recursive:true});
const jobs=configs.map(({name,file,env,port})=>{
  if(!env.METRICS_PORT)fs.appendFileSync(file,`\nMETRICS_PORT=${port}\n`);
  fs.writeFileSync(path.join(folder,'secrets',`${name}-key`),env.OBSERVABILITY_KEY);
  return {job_name:`flight-booking-${name}`,metrics_path:'/internal/metrics',
    http_headers:{'x-observability-key':{files:[`/etc/prometheus/secrets/${name}-key`]}},
    static_configs:[{targets:[`host.docker.internal:${port}`],labels:{application:'flight-booking',service:name}}]};
});
fs.writeFileSync(path.join(folder,'prometheus.json'),JSON.stringify({global:{scrape_interval:'5s',scrape_timeout:'3s'},scrape_configs:jobs},null,2)+'\n');
const password=path.join(folder,'grafana-admin-password');
if(!fs.existsSync(password))fs.writeFileSync(password,crypto.randomBytes(32).toString('hex'));
console.log('Monitoring configuration generated in ignored .local/monitoring. Restart host services to enable metrics ports.');
