import http from 'k6/http';
import { Counter } from 'k6/metrics';
const fixture=JSON.parse(open(__ENV.FIXTURE));
const statuses=new Counter('gateway_status');
export const options={scenarios:{gateway:{executor:'constant-arrival-rate',rate:20,timeUnit:'1s',duration:'10s',preAllocatedVUs:20,maxVUs:50}},thresholds:{'gateway_status{status:200}':['count>=0'],'gateway_status{status:429}':['count>=0']}};
export function setup(){
  const response=http.post('http://[::1]:3001/api/v1/signIn',JSON.stringify({email:fixture.email,password:fixture.password}),{headers:{'Content-Type':'application/json'},timeout:'10s'});
  if(response.status!==201) throw new Error('Gateway test authentication failed');
  return response.json('data');
}
export default function(token){
  const response=http.get(`http://[::1]:3010/flightService/api/v1/flights/${fixture.flightIds[0]}`,{headers:{'x-access-token':token},timeout:'10s'});
  statuses.add(1,{status:String(response.status)});
}
export function handleSummary(data){return {[__ENV.SUMMARY_FILE]:JSON.stringify(data,null,2)};}
