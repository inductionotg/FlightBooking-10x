const fs = require('node:fs');
const path = require('node:path');
const datasource={type:'prometheus',uid:'flight-prometheus'};
const scope='application="flight-booking"';
const requests=`sum by (service) (rate(http_requests_total{${scope}}[2m]))`;
const outcomes=`sum(rate(booking_responses_total{${scope}}[2m]))`;
let nextId=1;
function panel(title,expr,legend,unit,x,y,w=12,h=8,type='timeseries',description=''){
  return {id:nextId++,title,type,description,datasource,gridPos:{x,y,w,h},
    targets:[{refId:'A',expr,legendFormat:legend,range:type==='timeseries',instant:type==='stat'}],
    fieldConfig:{defaults:{unit,decimals:2,noValue:'No traffic / data',color:{mode:'palette-classic'},custom:{drawStyle:'line',lineWidth:2,fillOpacity:8,spanNulls:false}},overrides:[]},
    options:type==='stat'?{reduceOptions:{calcs:['lastNotNull'],fields:'',values:false},textMode:'value_and_name',colorMode:'value',graphMode:'none',orientation:'auto'}:
      {legend:{displayMode:'table',placement:'bottom',calcs:['lastNotNull']},tooltip:{mode:'multi',sort:'desc'}}};
}
const panels=[
  {id:nextId++,type:'text',title:'Flight Booking · Local service overview',gridPos:{x:0,y:0,w:24,h:3},options:{mode:'markdown',content:'**Services → Prometheus → Grafana** · Scraped every 5 seconds. Rates use the last 2 minutes. Booking figures count responses, including retries. Idle panels show no traffic; this dashboard makes no 10x-capacity claim.'}},
  panel('Service scrape health','up{'+scope+'}','{{service}}','short',0,3,8,5,'stat','1 = reachable and metrics parse correctly; 0 = scrape failure. This is not an application transaction health check.'),
  panel('Requests / second',`sum(rate(http_requests_total{${scope}}[2m]))`,'All services','reqps',8,3,8,5,'stat','Counts requests at every service hop. One user request can contribute multiple internal requests.'),
  panel('Booking confirmation',`100 * ((sum(rate(booking_responses_total{${scope},outcome="Booked"}[2m])) or (0 * ${outcomes})) / ${outcomes})`,'Confirmed','percent',16,3,8,5,'stat','Booked create/retry responses divided by all create/retry outcomes. No activity yields no percentage. Cancellations are excluded.'),
  panel('HTTP 5xx response rate',`100 * ((sum by (service) (rate(http_requests_total{${scope},status=~"5.."}[2m])) or on (service) (0 * ${requests})) / ${requests})`,'{{service}}','percent',0,8,12,8,'timeseries','Server errors only. 4xx, including the gateway rate limiter and client aborts, are not included.'),
  panel('HTTP p95 latency (histogram estimate)',`histogram_quantile(0.95, sum by (service,le) (rate(http_request_duration_seconds_bucket{${scope}}[2m])))`,'{{service}}','s',12,8),
  panel('Booking response outcomes / second',`sum by (outcome) (rate(booking_responses_total{${scope}}[2m]))`,'{{outcome}}','reqps',0,16),
  panel('Dependency p95 latency',`histogram_quantile(0.95, sum by (service,dependency,operation,le) (rate(dependency_duration_seconds_bucket{${scope}}[2m])))`,'{{service}} → {{dependency}} · {{operation}}','s',12,16,12,8,'timeseries','Combines success and error timings for existing auth and reservation/release HTTP calls. No payment service exists yet.'),
  panel('Service memory (RSS)',`process_resident_memory_bytes{${scope}}`,'{{service}}','bytes',0,24),
  panel('Background job completions / second',`sum by (service,operation,outcome) (rate(background_jobs_total{${scope}}[2m]))`,'{{service}} · {{operation}} · {{outcome}}','ops',12,24)
];
const health=panels.find(p=>p.title==='Service scrape health');
health.fieldConfig.defaults.mappings=[{type:'value',options:{'0':{text:'DOWN',color:'red'},'1':{text:'UP',color:'green'}}}];
const dashboard={uid:'flight-booking-overview',title:'Flight Booking · Service Overview',tags:['flight-booking','local'],schemaVersion:39,version:1,editable:false,refresh:'5s',timezone:'browser',time:{from:'now-15m',to:'now'},panels};
const folder=path.resolve(__dirname,'../observability/grafana/dashboards');
fs.mkdirSync(folder,{recursive:true});
fs.writeFileSync(path.join(folder,'flight-booking.json'),JSON.stringify(dashboard,null,2)+'\n');
console.log('Generated the provisioned Flight Booking dashboard.');
