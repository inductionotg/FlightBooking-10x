const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const results=path.join(__dirname,'results');
const rows=[];
for(const name of fs.readdirSync(results)){
  const folder=path.join(results,name);
  if(!fs.existsSync(path.join(folder,'summary.json'))||!fs.existsSync(path.join(folder,'diagnostics.json')))continue;
  const summary=JSON.parse(fs.readFileSync(path.join(folder,'summary.json')));
  const d=JSON.parse(fs.readFileSync(path.join(folder,'diagnostics.json')));
  const m=summary.metrics;
  const elapsed=(new Date(d.after.time)-new Date(d.before.time))/1000;
  const digestDeltas=d.digestsAfter.map(a=>{
    const b=d.digestsBefore.find(b=>b.DIGEST===a.DIGEST&&b.SCHEMA_NAME===a.SCHEMA_NAME)||{};
    const count=Number(a.COUNT_STAR)-Number(b.COUNT_STAR||0);
    const rows=Number(a.SUM_ROWS_EXAMINED)-Number(b.SUM_ROWS_EXAMINED||0);
    const totalMs=(Number(a.SUM_TIMER_WAIT)-Number(b.SUM_TIMER_WAIT||0))/1e9;
    return {schema:a.SCHEMA_NAME,sql:a.DIGEST_TEXT,count,rowsExamined:rows,rowsPerQuery:count?rows/count:0,totalMs,meanMs:count?totalMs/count:0};
  }).filter(r=>r.count>0).sort((a,b)=>b.totalMs-a.totalMs);
  const cpu=Array.isArray(d.processesBefore)&&Array.isArray(d.processesAfter)?d.processesAfter.map(a=>{
    const b=d.processesBefore.find(b=>b.Id===a.Id);
    return {pid:a.Id,cpuSeconds:b?a.CPU-b.CPU:null,workingSetMiB:a.WorkingSet64/2**20};
  }):null;
  rows.push({run:name,kind:d.kind,requests:m.http_reqs?.values.count,throughput:m.http_reqs?.values.rate,
    failureRate:m.http_req_failed?.values.rate,businessSuccess:m.business_success?.values.rate,
    p95:m.http_req_duration?.values['p(95)'],p99:m.http_req_duration?.values['p(99)'],
    searchP95:m.search_latency?.values['p(95)'],detailsP95:m.details_latency?.values['p(95)'],bookingP95:m.booking_latency?.values['p(95)'],
    dropped:m.dropped_iterations?.values.count||0,exitCode:d.exitCode,
    gateway200:m['gateway_status{status:200}']?.values.count,gateway429:m['gateway_status{status:429}']?.values.count,
    confirmed:m.confirmed_bookings?.values.count,inventoryDrift:d.inventory.reduce((n,f)=>n+f.drift,0),
    peakConnections:Math.max(...d.samples.map(s=>s.Threads_connected),d.before.Threads_connected,d.after.Threads_connected),
    peakRunning:Math.max(...d.samples.map(s=>s.Threads_running),d.before.Threads_running,d.after.Threads_running),
    maxConnectionErrors:d.after.Connection_errors_max_connections-d.before.Connection_errors_max_connections,
    questions:d.after.Questions-d.before.Questions,elapsed,processes:cpu,digestDeltas});
}
fs.writeFileSync(path.join(results,'analysis.json'),JSON.stringify(rows,null,2));
console.log(JSON.stringify(rows.map(({digestDeltas,processes,...row})=>({...row,topQueries:digestDeltas.slice(0,2)})),null,2));
