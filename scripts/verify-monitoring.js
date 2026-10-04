const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const report={timestamp:new Date().toISOString(),checks:[]};
const pass=name=>{report.checks.push({name,passed:true});console.log('PASS: '+name);};
async function json(url){const response=await fetch(url,{signal:AbortSignal.timeout(10000)});assert.equal(response.status,200,`HTTP ${response.status}: ${new URL(url).pathname}`);return response.json();}
const prometheus='http://127.0.0.1:39090';
const grafana='http://127.0.0.1:33000';
async function query(expression){const data=await json(`${prometheus}/api/v1/query?query=${encodeURIComponent(expression)}`);assert.equal(data.status,'success');return data.data.result;}
async function main(){
  const targets=(await json(`${prometheus}/api/v1/targets`)).data.activeTargets.filter(t=>t.labels.application==='flight-booking');
  assert.equal(targets.length,5);assert.ok(targets.every(t=>t.health==='up'&&!t.lastError));
  report.targets=targets.map(t=>({service:t.labels.service,health:t.health,lastScrape:t.lastScrape}));
  pass('All five services are being scraped successfully');
  const uptime=await query('process_uptime_seconds{application="flight-booking"}');
  assert.equal(uptime.length,5);assert.ok(uptime.every(t=>Number(t.value[1])>0));
  pass('Prometheus stores live process metrics from every service');
  const expression='sum(http_requests_total{application="flight-booking",service="flights",route="/flights/:id",status="200"})';
  const before=Number((await query(expression))[0]?.value[1] || 0);
  const fixture=JSON.parse(fs.readFileSync(path.join(root,'.local/redis-test-fixture.json')));
  const read=await fetch(`http://[::1]:3002/api/v1/flights/${fixture.flightId}`,{signal:AbortSignal.timeout(5000)});
  assert.equal(read.status,200);await read.arrayBuffer();
  let observed=false;
  for(let attempt=0;attempt<10;attempt++){
    const after=Number((await query(expression))[0]?.value[1] || 0);
    if(after>before){observed=true;break;}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert.ok(observed,'Prometheus should scrape the new HTTP counter increment');
  pass('A real read-only flight request appears in collected HTTP metrics');
  const dotenv=require(path.join(root,'Auth_Service/node_modules/dotenv'));
  for(const dir of ['Auth_Service','Booking_Service','FlightandSearchService','ReminderService','AIRLINE-MANAGEMENT_API_GATEWAY']){
    const env=dotenv.parse(fs.readFileSync(path.join(root,dir,'.env')));
    const denied=await fetch(`http://127.0.0.1:${env.METRICS_PORT}/internal/metrics`,{signal:AbortSignal.timeout(3000)});
    assert.equal(denied.status,401);
    const api=await fetch(`http://127.0.0.1:${env.METRICS_PORT}/api/v1/flights`,{signal:AbortSignal.timeout(3000)});
    assert.equal(api.status,404);
  }
  pass('Dedicated metrics listeners require credentials and expose no business API routes');
  assert.equal((await json(`${grafana}/api/health`)).database,'ok');
  const saved=await json(`${grafana}/api/dashboards/uid/flight-booking-overview`);
  const expected=JSON.parse(fs.readFileSync(path.join(root,'observability/grafana/dashboards/flight-booking.json')));
  assert.equal(saved.dashboard.uid,expected.uid);
  assert.equal(saved.dashboard.panels.length,expected.panels.length);
  for(const panel of expected.panels){
    const actual=saved.dashboard.panels.find(p=>p.id===panel.id);assert.ok(actual);
    for(const target of panel.targets||[]){assert.equal(actual.targets.find(t=>t.refId===target.refId).expr,target.expr);await query(target.expr);}
  }
  pass('Grafana provisioned the dashboard and every panel query is valid');
  const response=await fetch(`${grafana}/api/ds/query`,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify({
    from:String(Date.now()-60000),to:String(Date.now()),queries:[{refId:'A',datasource:{type:'prometheus',uid:'flight-prometheus'},
      expr:'up{application="flight-booking"}',instant:true,range:false,intervalMs:5000,maxDataPoints:100}]
  })});
  assert.equal(response.status,200);
  const proxied=(await response.json()).results.A;
  assert.equal(proxied.status,200);assert.equal(proxied.frames.length,5);
  assert.ok(proxied.frames.every(frame=>frame.data.values[1][0]===1));
  pass('Grafana can query Prometheus through its provisioned data source');
  report.passed=true;
}
main().catch(error=>{report.passed=false;report.error=error.message;process.exitCode=1;console.error(error.message);}).finally(()=>fs.writeFileSync(path.join(root,'docs/monitoring-test-results.json'),JSON.stringify(report,null,2)+'\n'));
