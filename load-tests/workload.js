import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';
import { Rate, Trend } from 'k6/metrics';
const fixture=JSON.parse(open(__ENV.FIXTURE));
const flightBase=__ENV.FLIGHT_BASE||'http://[::1]:3002';
const bookingBase=__ENV.BOOKING_BASE||'http://[::1]:3003';
const success=new Rate('business_success');
const latency={search:new Trend('search_latency',true),details:new Trend('details_latency',true),booking:new Trend('booking_latency',true)};
export function makeOptions(multiplier) {
  const base=Number(__ENV.BASE_RPS||20)*multiplier;
  const duration=__ENV.DURATION||'60s';
  const scenarios={};
  for(const [name,share] of [['search',0.7],['details',0.2],['booking',0.1]]) {
    const rate=base*share;
    if(!Number.isInteger(rate)) throw new Error('Rate must produce whole-number 70/20/10 shares');
    scenarios[name]={executor:'constant-arrival-rate',exec:name,rate,timeUnit:'1s',duration,
      preAllocatedVUs:Math.max(10,rate),maxVUs:Math.max(50,rate*5),gracefulStop:'15s'};
  }
  return {scenarios,summaryTrendStats:['avg','med','p(95)','p(99)','max'],thresholds:{
    http_req_failed:['rate<0.01'],business_success:['rate>0.99'],
    search_latency:['p(95)<500'],details_latency:['p(95)<500'],booking_latency:['p(95)<1000'],
    dropped_iterations:['count==0']
  }};
}
function record(kind,response,predicate) {
  let good=false;
  try {const body=response.json();good=response.status===200&&body.success===true&&predicate(body.data);}catch(_){}
  check(response,{[`${kind}: valid response`]:()=>good});success.add(good,{endpoint:kind});latency[kind].add(response.timings.duration);
}
export function search() {
  const route=fixture.routes[exec.scenario.iterationInTest%fixture.routes.length];
  const response=http.get(`${flightBase}/api/v1/flights?departureAirportId=${route.departureAirportId}&arrivalAirportId=${route.arrivalAirportId}&minPrice=2000&maxPrice=10000`,{tags:{name:'flight-search'},timeout:'10s'});
  record('search',response,data=>Array.isArray(data)&&data.length===100&&data.every(f=>f.departureAirportId===route.departureAirportId&&f.arrivalAirportId===route.arrivalAirportId));
}
export function details() {
  const id=fixture.flightIds[exec.scenario.iterationInTest%100];
  const response=http.get(`${flightBase}/api/v1/flights/${id}`,{tags:{name:'flight-details'},timeout:'10s'});
  record('details',response,data=>data.id===id);
}
export function booking() {
  const id=fixture.bookingIds[exec.scenario.iterationInTest%fixture.bookingIds.length];
  const response=http.post(`${bookingBase}/api/v1/booking`,JSON.stringify({flightId:id,noOfSeats:1}),
    {headers:{'Content-Type':'application/json','x-access-token':fixture.token},tags:{name:'booking'},timeout:'10s'});
  record('booking',response,data=>data.flightId===id&&data.status==='Booked'&&data.totalCost===2500);
}
export function handleSummary(data) {
  return {[__ENV.SUMMARY_FILE||'summary.json']:JSON.stringify(data,null,2),stdout:JSON.stringify({summary:__ENV.SUMMARY_FILE,metrics:data.metrics},null,2)+'\n'};
}
