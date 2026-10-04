'use strict';
// Canonical source. scripts/sync-observability.js copies this into each standalone service.
const {AsyncLocalStorage} = require('node:async_hooks');
const {randomBytes, timingSafeEqual} = require('node:crypto');
const context = new AsyncLocalStorage();
let service = 'unconfigured';
const metrics = new Map();
const id = bytes => randomBytes(bytes).toString('hex');
const allowed = new Set(['method','route','status','durationMs','dependency','operation','outcome','bookingId','ticketId','errorType','port','count']);
function log(event, fields = {}, level = 'info') {
  const safe = Object.fromEntries(Object.entries(fields).filter(([key,value]) => allowed.has(key) && ['string','number','boolean'].includes(typeof value)));
  const active = context.getStore() || {};
  process.stdout.write(JSON.stringify({timestamp:new Date().toISOString(),level,service,event,...active,...safe})+'\n');
}
function add(name, labels, value = 1) {
  const pairs = {service,...labels};
  const key = name + JSON.stringify(pairs);
  const previous = metrics.get(key);
  metrics.set(key,{name,labels:pairs,value:(previous?.value || 0)+value});
}
function observe(name, labels, seconds) {
  add(name+'_count',labels); add(name+'_sum',labels,seconds);
  for (const limit of [0.01,0.05,0.1,0.5,1,3,10,Infinity]) {
    add(name+'_bucket',{...labels,le:limit===Infinity?'+Inf':String(limit)}, seconds<=limit?1:0);
  }
}
function trace(incoming) {
  const match = typeof incoming === 'string' && /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(incoming);
  return match && !/^0+$/.test(match[1]) && !/^0+$/.test(match[2])
    ? {traceId:match[1],spanId:id(8),parentSpanId:match[2],traceFlags:match[3]}
    : {traceId:id(16),spanId:id(8),traceFlags:'01'};
}
function headers() {
  const c = context.getStore();
  return c ? {traceparent:`00-${c.traceId}-${c.spanId}-${c.traceFlags}`} : {};
}
async function span(dependency, operation, work) {
  const parent = context.getStore();
  const child = parent ? {...parent,parentSpanId:parent.spanId,spanId:id(8)} : trace();
  return context.run(child, async()=>{
    const start = performance.now(); let outcome = 'success';
    try { return await work(headers()); }
    catch (error) { outcome='error'; throw error; }
    finally {
      const durationMs = performance.now()-start;
      observe('dependency_duration_seconds',{dependency,operation,outcome},durationMs/1000);
      log('dependency.completed',{dependency,operation,outcome,durationMs},outcome==='error'?'error':'info');
    }
  });
}
function bookingOutcome(booking) {
  const outcome = ['Booked','Cancelled','InProcess'].includes(booking.status) ? booking.status : 'unknown';
  add('booking_responses_total',{outcome});
  log('booking.response',{bookingId:booking.id,outcome});
}
function render() {
  const escape = value => String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n');
  const lines = ['# TYPE http_requests_total counter','# TYPE http_request_duration_seconds histogram',
    '# TYPE dependency_duration_seconds histogram','# TYPE booking_responses_total counter',
    '# TYPE background_jobs_total counter','# TYPE notification_deliveries_total counter',
    '# TYPE booking_events_total counter','# TYPE booking_notifications_total counter','# TYPE booking_notification_deliveries_total counter'];
  for (const row of metrics.values()) {
    const labels = Object.entries(row.labels).map(([k,v])=>`${k}="${escape(v)}"`).join(',');
    lines.push(`${row.name}{${labels}} ${row.value}`);
  }
  lines.push('# TYPE process_uptime_seconds gauge',`process_uptime_seconds{service="${service}"} ${process.uptime()}`);
  lines.push('# TYPE process_resident_memory_bytes gauge',`process_resident_memory_bytes{service="${service}"} ${process.memoryUsage().rss}`);
  return lines.join('\n')+'\n';
}
function install(app, name) {
  service = name;
  app.use((req,res,next)=>context.run(trace(req.headers.traceparent),()=>{
    res.setHeader('x-trace-id',context.getStore().traceId);
    res.setHeader('traceparent',headers().traceparent);
    const started = performance.now(); const active = context.getStore(); let recorded = false;
    const finish = aborted => {
      if (recorded) return; recorded=true;
      context.run(active,()=>{
        const route = req.telemetryRoute || req.route?.path || 'unmatched';
        const method = ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD'].includes(req.method)?req.method:'OTHER';
        const status = aborted ? 499 : res.statusCode;
        const durationMs = performance.now()-started;
        if (route !== '/internal/metrics') {
          add('http_requests_total',{method,route,status});
          observe('http_request_duration_seconds',{method,route},durationMs/1000);
          log('http.completed',{method,route,status,durationMs},status>=500?'error':status>=400?'warn':'info');
        }
      });
    };
    res.once('finish',()=>finish(false)); res.once('close',()=>finish(!res.writableFinished));
    next();
  }));
  const serveMetrics = (req,res)=>{
    const key = process.env.OBSERVABILITY_KEY;
    const supplied = req.get('x-observability-key');
    if (!key) return res.status(503).json({message:'Metrics access is not configured'});
    const expected = Buffer.from(key), actual = Buffer.from(supplied || '');
    if (actual.length!==expected.length || !timingSafeEqual(actual,expected)) return res.sendStatus(401);
    res.type('text/plain; version=0.0.4').send(render());
  };
  app.get('/internal/metrics',serveMetrics);
  // Optional dedicated listener for host applications scraped from Docker Desktop.
  if (process.env.METRICS_PORT) {
    const port = Number(process.env.METRICS_PORT);
    if (!Number.isInteger(port) || port<1024 || port>65535) throw new Error('Invalid METRICS_PORT');
    const metricsApp = require('express')();
    metricsApp.get('/internal/metrics',serveMetrics);
    const server = metricsApp.listen(port,'0.0.0.0',()=>log('metrics.started',{port}));
    server.on('error',error=>log('metrics.listener_failed',{errorType:error.name},'error'));
  }
}
function errorHandler(error,req,res,next) {
  log('http.error',{errorType:error.name || 'Error'},'error');
  if (res.headersSent) return next(error);
  res.status(error.status || 500).json({success:false,message:error.status===400?'Invalid request':'Internal server error'});
}
function job(operation, work) {
  return context.run(trace(),async()=>{
    let outcome='success';
    try { return await work(); }
    catch(error) { outcome='error'; log('job.error',{operation,errorType:error.name},'error'); throw error; }
    finally { add('background_jobs_total',{operation,outcome}); log('job.completed',{operation,outcome}); }
  });
}
module.exports = {install,log,add,observe,span,headers,bookingOutcome,errorHandler,job,context,trace,render};
