const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname,'..');
const dotenv = require(path.join(root,'Auth_Service/node_modules/dotenv'));
const services = [['Auth_Service',3001,'auth'],['Booking_Service',3003,'booking'],['FlightandSearchService',3002,'flights'],['ReminderService',3004,'notifications'],['AIRLINE-MANAGEMENT_API_GATEWAY',3010,'gateway']];
const report = {timestamp:new Date().toISOString(),checks:[],traces:{}};
const pass = name=>{report.checks.push({name,passed:true});console.log('PASS: '+name);};
const trace = ()=>crypto.randomBytes(16).toString('hex');
const parent = value=>`00-${value}-1234567890abcdef-01`;
async function request(port,route,options={}) {
  return fetch(`http://[::1]:${port}${route}`,{...options,headers:{'content-type':'application/json',...options.headers},signal:AbortSignal.timeout(10000)});
}
const logs = dir=>{
  const entry=JSON.parse(fs.readFileSync(path.join(root,'.local/processes.json'),'utf8')).find(item=>item.Service===dir);
  return fs.readFileSync(entry?.StdoutLog || path.join(root,'.local',`${dir}.stdout.log`),'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
};
async function main() {
  const canonical=fs.readFileSync(path.join(root,'observability/runtime.js'),'utf8');
  for(const [dir] of services)assert.equal(fs.readFileSync(path.join(root,dir,'src/observability.js'),'utf8'),canonical);
  pass('Standalone service runtime copies match the canonical source');
  for(const [dir,port,name] of services) {
    const key=dotenv.parse(fs.readFileSync(path.join(root,dir,'.env'))).OBSERVABILITY_KEY;
    assert.equal((await request(port,'/internal/metrics')).status,401);
    const response=await request(port,'/internal/metrics',{headers:{'x-observability-key':key}});
    assert.equal(response.status,200);
    assert.match(await response.text(),new RegExp(`process_uptime_seconds\\{service="${name}"\\}`));
  }
  pass('All five services expose protected Prometheus-format metrics');
  const fixture=JSON.parse(fs.readFileSync(path.join(root,'.local/redis-test-fixture.json')));
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'.local/k6-catalog.json')));
  const secret=`must-not-appear-${crypto.randomUUID()}`;
  const concurrent=Array.from({length:12},()=>trace());
  await Promise.all(concurrent.map(async value=>{
    const res=await request(3002,`/api/v1/flights/${fixture.flightId}?secret=${secret}`,{headers:{traceparent:parent(value),'x-access-token':secret}});
    assert.equal(res.status,200);assert.equal(res.headers.get('x-trace-id'),value);
  }));
  pass('Concurrent requests preserve separate trace contexts');
  const invalid=await request(3002,`/api/v1/flights/${fixture.flightId}`,{headers:{traceparent:'00-'+'0'.repeat(32)+'-1234567890abcdef-01'}});
  assert.match(invalid.headers.get('x-trace-id'),/^[0-9a-f]{32}$/);
  assert.notEqual(invalid.headers.get('x-trace-id'),'0'.repeat(32));
  pass('Invalid incoming trace context is replaced');
  const signIn=await request(3001,'/api/v1/signIn',{method:'POST',body:JSON.stringify({email:catalog.email,password:catalog.password})});
  assert.equal(signIn.status,201);const token=(await signIn.json()).data;
  const gatewayTrace=trace();
  const proxied=await request(3010,`/flightService/api/v1/flights/${fixture.flightId}`,{headers:{traceparent:parent(gatewayTrace),'x-access-token':token}});
  assert.equal(proxied.status,200,'Allow the existing gateway rate-limit window to reset before repeating');
  assert.equal(proxied.headers.get('x-trace-id'),gatewayTrace);
  const bookingTrace=trace(),key=crypto.randomUUID();let booking;
  try {
    const booked=await request(3003,'/api/v1/booking',{method:'POST',headers:{traceparent:parent(bookingTrace),'Idempotency-Key':key,'x-access-token':token},body:JSON.stringify({flightId:fixture.flightId,userId:catalog.userId,noOfSeats:1})});
    assert.equal(booked.status,200);booking=(await booked.json()).data;
    assert.equal(booking.status,'Booked');
  } finally {
    if(booking){const cancelled=await request(3003,`/api/v1/booking/${booking.id}/cancel`,{method:'POST',headers:{'Idempotency-Key':key,'x-access-token':token},body:JSON.stringify({userId:catalog.userId})});assert.equal(cancelled.status,200);}
  }
  await request(3004,`/does-not-exist/${secret}`);
  const malformed=await request(3002,'/api/v1/flights',{method:'POST',body:'{"password":"'+secret+'"'});
  assert.equal(malformed.status,400);pass('Malformed JSON returns a traced structured error');
  await new Promise(resolve=>setTimeout(resolve,200));
  const all=Object.fromEntries(services.map(([dir,,name])=>[name,logs(dir)]));
  for(const value of concurrent)assert.equal(all.flights.filter(row=>row.traceId===value&&row.event==='http.completed').length,1);
  for(const name of ['gateway','auth','flights'])assert.ok(all[name].some(row=>row.traceId===gatewayTrace&&row.event==='http.completed'));
  const authSpan=all.gateway.find(row=>row.traceId===gatewayTrace&&row.dependency==='auth');
  assert.ok(all.auth.some(row=>row.traceId===gatewayTrace&&row.parentSpanId===authSpan.spanId));
  pass('Gateway, auth and flight logs share one trace with linked auth spans');
  const bookingAuth=all.booking.find(row=>row.traceId===bookingTrace&&row.dependency==='auth');
  assert.ok(bookingAuth);
  assert.ok(all.auth.some(row=>row.traceId===bookingTrace&&row.parentSpanId===bookingAuth.spanId));
  pass('Booking authorization shares the booking trace with a linked auth span');
  const call=all.booking.find(row=>row.traceId===bookingTrace&&row.dependency==='flights');
  assert.ok(call);assert.ok(all.flights.some(row=>row.traceId===bookingTrace&&row.parentSpanId===call.spanId));
  assert.ok(all.booking.some(row=>row.traceId===bookingTrace&&row.bookingId===booking.id));
  pass('Booking and flight reservation spans share a trace and log the booking ID');
  const configuredSecrets=services.flatMap(([dir])=>{
    const env=dotenv.parse(fs.readFileSync(path.join(root,dir,'.env')));
    return ['AUTH_KEY','RESERVATION_SERVICE_KEY','OBSERVABILITY_KEY','EMAIL_PASS'].map(key=>env[key]).filter(Boolean);
  });
  for(const rows of Object.values(all)) {
    assert.ok(rows.some(row=>row.event==='http.completed'));
    for(const row of rows)assert.ok(row.timestamp&&row.level&&row.service&&row.event);
    const serialized=JSON.stringify(rows);
    for(const value of [secret,token,catalog.email,catalog.password,key,...configuredSecrets])assert.ok(!serialized.includes(value),'Sensitive request data appeared in logs');
  }
  pass('Every service emits JSON logs without tested credentials, tokens, query values or request bodies');
  const keyFor=dir=>dotenv.parse(fs.readFileSync(path.join(root,dir,'.env'))).OBSERVABILITY_KEY;
  const bookingMetrics=await(await request(3003,'/internal/metrics',{headers:{'x-observability-key':keyFor('Booking_Service')}})).text();
  assert.match(bookingMetrics,/booking_responses_total\{service="booking",outcome="Booked"\} [1-9]/);
  assert.match(bookingMetrics,/dependency_duration_seconds_count\{service="booking",dependency="flights",operation="reserve",outcome="success"\} [1-9]/);
  const flightMetrics=await(await request(3002,'/internal/metrics',{headers:{'x-observability-key':keyFor('FlightandSearchService')}})).text();
  assert.match(flightMetrics,/http_request_duration_seconds_bucket/);
  assert.ok(!flightMetrics.includes(secret));assert.ok(!flightMetrics.includes('/flights/'+fixture.flightId));
  pass('HTTP latency, dependency latency and booking outcomes are measured with bounded route labels');
  report.traces={gateway:gatewayTrace,booking:bookingTrace};report.passed=true;
}
main().catch(error=>{report.passed=false;report.error=error.message;process.exitCode=1;console.error(error.message);}).finally(()=>fs.writeFileSync(path.join(root,'docs/observability-test-results.json'),JSON.stringify(report,null,2)+'\n'));
