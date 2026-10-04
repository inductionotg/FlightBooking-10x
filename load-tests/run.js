const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {prepare}=require('./prepare.js');
const root=path.resolve(__dirname,'..');
const mysql=require(path.join(root,'FlightandSearchService/node_modules/mysql2/promise'));
const kind=process.argv[2]||'baseline';
const run=process.argv[3]||`${kind}-${Date.now()}`;
const duration=process.argv[4]||'60s';
assert.ok(['baseline','10x','gateway','contention'].includes(kind));assert.match(run,/^[a-z0-9-]+$/);
assert.match(duration,/^\d+s$/);
const folder=path.join(root,'load-tests/results',run);
assert.ok(!fs.existsSync(folder),'Refusing to overwrite an existing run');
fs.mkdirSync(folder,{recursive:true});
const k6=process.env.K6_BINARY||path.join(root,'.local/tools/k6/k6-v2.3.0-windows-amd64/k6.exe');
function processSnapshot(){
  try {
    const pids=JSON.parse(fs.readFileSync(path.join(root,'.local/processes.json'))).map(p=>Number(p.ProcessId));
    return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,CPU,WorkingSet64 | ConvertTo-Json -Compress`],{encoding:'utf8',timeout:10000}));
  }catch(error){return {unavailable:error.message};}
}
async function main(){
  const fixturePath=await prepare(run), fixture=JSON.parse(fs.readFileSync(fixturePath));
  const db=await mysql.createConnection({host:'127.0.0.1',port:33306,user:'root',password:'baseline-local-only'});
  if(kind==='contention'){
    fixture.bookingIds=[fixture.bookingIds[0]];fixture.initialSeats=1;
    await db.query('UPDATE baseline_flights.Flights SET totalSeats=1 WHERE id=?',[fixture.bookingIds[0]]);
    fs.writeFileSync(fixturePath,JSON.stringify(fixture));
  }
  const report={run,kind,duration:kind==='contention'?'20 concurrent iterations, max 30s':kind==='gateway'?'10s':duration,started:new Date().toISOString(),assumedNormalRps:20,targetRps:kind==='contention'?null:kind==='10x'?200:20,
    host:{platform:os.platform(),cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,memoryGiB:os.totalmem()/2**30,node:process.version},
    k6:execFileSync(k6,['version'],{encoding:'utf8'}).trim(),samples:[],processesBefore:processSnapshot()};
  try{
    async function cacheMetrics(){
      try {
        const dotenv=require(path.join(root,'FlightandSearchService/node_modules/dotenv'));
        const key=dotenv.parse(fs.readFileSync(path.join(root,'FlightandSearchService/.env'))).RESERVATION_SERVICE_KEY;
        const response=await fetch('http://[::1]:3002/api/v1/internal/cache-metrics',{headers:{'x-reservation-key':key},signal:AbortSignal.timeout(1000)});
        return response.ok?(await response.json()).data:{unavailable:true};
      }catch(_){return {unavailable:true};}
    }
    async function snapshot(){
      const [status]=await db.query("SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Questions','Slow_queries','Connection_errors_max_connections','Innodb_row_lock_waits')");
      return {time:new Date().toISOString(),...Object.fromEntries(status.map(r=>[r.Variable_name,Number(r.Value)]))};
    }
    async function digests(){
      const [rows]=await db.query("SELECT SCHEMA_NAME,DIGEST,DIGEST_TEXT,COUNT_STAR,SUM_TIMER_WAIT,SUM_ROWS_EXAMINED,SUM_ROWS_SENT FROM performance_schema.events_statements_summary_by_digest WHERE SCHEMA_NAME IN ('baseline_flights','baseline_booking')");return rows;
    }
    report.cacheBefore=await cacheMetrics();
    report.before=await snapshot(); report.digestsBefore=await digests();
    const [settings]=await db.query('SELECT @@max_connections AS maxConnections, VERSION() AS mysqlVersion');report.mysql=settings[0];
    report.cacheSamples=[];
    const r=fixture.routes[0];
    const [plan]=await db.query('EXPLAIN SELECT * FROM baseline_flights.Flights WHERE departureAirportId=? AND arrivalAirportId=? AND price>=2000 AND price<=10000',[r.departureAirportId,r.arrivalAirportId]);report.searchPlan=plan;
    const [indexes]=await db.query('SHOW INDEX FROM baseline_flights.Flights');report.flightIndexes=indexes;
    const [counts]=await db.query('SELECT COUNT(*) AS flights FROM baseline_flights.Flights');report.catalog=counts[0];
    const summary=path.join(folder,'summary.json');
    const script=kind==='baseline'?'baseline-test.js':kind==='10x'?'10x-simulation.js':`${kind}-test.js`;
    const output=fs.openSync(path.join(folder,'k6.log'),'w');
    console.log(`Starting ${run}: ${kind==='contention'?'20 concurrent booking attempts':`${report.targetRps} requests/s`}, ${report.duration}`);
    const child=spawn(k6,['run','--no-usage-report','--address','127.0.0.1:0','--new-machine-readable-summary=false',path.join(__dirname,script)],{
      cwd:root,env:{...process.env,FIXTURE:fixturePath.replaceAll('\\','/'),SUMMARY_FILE:summary.replaceAll('\\','/'),DURATION:duration},stdio:['ignore',output,output]
    });
    let busy=false;
    const interval=setInterval(async()=>{if(busy)return;busy=true;try{report.samples.push(await snapshot());report.cacheSamples.push({time:new Date().toISOString(),...(await cacheMetrics())});}catch(e){report.monitorError=e.message;}finally{busy=false;}},1000);
    try{report.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});}
    finally{clearInterval(interval);while(busy) await new Promise(resolve=>setTimeout(resolve,10));fs.closeSync(output);}
    report.after=await snapshot();report.digestsAfter=await digests();report.processesAfter=processSnapshot();report.cacheAfter=await cacheMetrics();
    const ids=fixture.bookingIds;
    const [seats]=await db.query(`SELECT id,totalSeats FROM baseline_flights.Flights WHERE id IN (${ids.map(()=>'?').join(',')})`,ids);
    const [bookings]=await db.query(`SELECT flightId,status,SUM(noOfSeats) AS seats,COUNT(*) AS bookings FROM baseline_booking.Bookings WHERE flightId IN (${ids.map(()=>'?').join(',')}) GROUP BY flightId,status`,ids);
    report.inventory=seats.map(f=>{const booked=Number(bookings.find(b=>b.flightId===f.id&&b.status==='Booked')?.seats||0);return {flightId:f.id,initial:fixture.initialSeats,remaining:f.totalSeats,booked,drift:booked-(fixture.initialSeats-f.totalSeats)};});
    report.bookingStates=bookings;
    console.log(JSON.stringify({run,exitCode:report.exitCode,summary,inventoryDrift:report.inventory.reduce((n,f)=>n+f.drift,0)}));
    if(report.exitCode!==0)process.exitCode=report.exitCode||1;
  }finally{report.finished=new Date().toISOString();fs.writeFileSync(path.join(folder,'diagnostics.json'),JSON.stringify(report,null,2));await db.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
