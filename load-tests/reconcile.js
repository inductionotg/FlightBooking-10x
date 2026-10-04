// Read-only follow-up: timed-out requests can finish on the server after k6 exits.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const mysql=require(path.join(root,'FlightandSearchService/node_modules/mysql2/promise'));
async function main(){
  const db=await mysql.createConnection({host:'127.0.0.1',port:33306,user:'root',password:'baseline-local-only'});
  const results=[];
  try{
    for(const run of fs.readdirSync(path.join(__dirname,'results'))){
      if(!/^[a-z0-9-]+$/.test(run))continue;
      const file=path.join(root,'.local',`k6-${run}.json`);
      if(!fs.existsSync(file))continue;
      const fixture=JSON.parse(fs.readFileSync(file));
      const ids=fixture.bookingIds;
      assert.ok(ids.every(Number.isInteger));
      const marks=ids.map(()=>'?').join(',');
      const [flights]=await db.query(`SELECT id,totalSeats FROM baseline_flights.Flights WHERE id IN (${marks})`,ids);
      const [states]=await db.query(`SELECT flightId,status,COUNT(*) AS bookings,SUM(noOfSeats) AS seats FROM baseline_booking.Bookings WHERE flightId IN (${marks}) GROUP BY flightId,status`,ids);
      const booked=states.filter(s=>s.status==='Booked').reduce((n,s)=>n+Number(s.seats),0);
      const inProcess=states.filter(s=>s.status==='InProcess').reduce((n,s)=>n+Number(s.bookings),0);
      const deducted=flights.reduce((n,f)=>n+fixture.initialSeats-f.totalSeats,0);
      results.push({run,checked:new Date().toISOString(),booked,inProcess,deducted,drift:booked-deducted,flights});
    }
  }finally{await db.end();}
  fs.writeFileSync(path.join(__dirname,'results/settled-inventory.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results.map(({flights,...r})=>r),null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
