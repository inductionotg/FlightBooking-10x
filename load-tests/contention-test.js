import http from 'k6/http';
import { Counter, Rate } from 'k6/metrics';
const fixture=JSON.parse(open(__ENV.FIXTURE));
const confirmed=new Counter('confirmed_bookings');
const rejected=new Counter('rejected_bookings');
const unexpected=new Rate('unexpected_response');
export const options={scenarios:{lastSeat:{executor:'shared-iterations',vus:20,iterations:20,maxDuration:'30s'}},thresholds:{confirmed_bookings:['count==1'],rejected_bookings:['count==19'],unexpected_response:['rate==0']}};
export default function(){
  const response=http.post('http://[::1]:3003/api/v1/booking',JSON.stringify({flightId:fixture.bookingIds[0],noOfSeats:1}),{headers:{'Content-Type':'application/json','x-access-token':fixture.token},timeout:'10s'});
  let booked=false,unavailable=false;try{booked=response.status===200&&response.json('data.status')==='Booked';unavailable=response.status===409&&response.json('code')==='INSUFFICIENT_SEATS';}catch(_){}
  if(booked)confirmed.add(1);if(unavailable)rejected.add(1);unexpected.add(!booked&&!unavailable);
}
export function handleSummary(data){return {[__ENV.SUMMARY_FILE]:JSON.stringify(data,null,2)};}
