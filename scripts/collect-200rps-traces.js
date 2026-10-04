// Extract a few sanitized, linked examples from local JSON logs before a restart overwrites them.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const run=process.argv[2];
if(!/^diagnose-200-[a-z0-9-]+$/.test(run||''))throw new Error('Usage: node scripts/collect-200rps-traces.js diagnose-200-...');
const d=JSON.parse(fs.readFileSync(path.join(root,'load-tests/results',run,'diagnostics.json')));
const begin=Date.parse(d.started),end=Date.parse(d.finished);
const logs=[['flights','FlightandSearchService'],['booking','Booking_Service'],['notifications','ReminderService']].flatMap(([name,dir])=>
  fs.readFileSync(path.join(root,'.local',`${dir}.stdout.log`),'utf8').split('\n').flatMap(line=>{
    try{const event=JSON.parse(line),time=Date.parse(event.timestamp);return time>=begin&&time<=end+120000?[{...event,source:name}]:[];}
    catch{return[];}
  }));
const within=logs.filter(x=>Date.parse(x.timestamp)<=end);
const examples=[
  within.find(x=>x.source==='flights'&&x.event==='http.completed'&&x.route==='/flights'&&x.status===503),
  within.find(x=>x.source==='flights'&&x.event==='http.completed'&&x.route==='/flights/:id'&&x.status===503),
  within.find(x=>x.source==='booking'&&x.event==='http.completed'&&x.route==='/booking'&&x.status===202)
];
if(examples.some(x=>!x))throw new Error('Expected traces are missing from the current logs');
const allowed=['timestamp','service','source','event','traceId','spanId','parentSpanId','method','route','status','durationMs','dependency','operation','outcome','bookingId'];
const report={run,started:d.started,finished:d.finished,examples:examples.map((x,i)=>({
  case:['search-503','details-503','booking-202'][i],traceId:x.traceId,
  events:logs.filter(y=>y.traceId===x.traceId).sort((a,b)=>a.timestamp.localeCompare(b.timestamp))
    .map(y=>Object.fromEntries(allowed.filter(key=>Object.hasOwn(y,key)).map(key=>[key,y[key]])))
}))};
const output=path.join(root,'docs/200rps-trace-evidence.json');
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(`Saved three linked trace examples from ${run}.`);
