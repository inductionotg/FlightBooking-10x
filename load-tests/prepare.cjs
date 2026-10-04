const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const local = path.join(root,'.local');
fs.mkdirSync(local,{recursive:true});
async function prepare(run) {
  assert.match(run,/^[a-z0-9-]+$/);
  const dbs = ['FlightandSearchService','Auth_Service'].map(dir=>{
    const config = require(path.join(root,dir,'src/config/config.json')).development;
    assert.equal(config.host,'127.0.0.1'); assert.equal(config.port,33306);
    assert.ok(['baseline_flights','baseline_auth'].includes(config.database));
    const db = require(path.join(root,dir,'src/models'));
    db.sequelize.options.logging=false; return db;
  });
  const [flights,auth] = dbs;
  try {
    const catalogPath=path.join(local,'k6-catalog.json');
    let catalog;
    if(fs.existsSync(catalogPath)) catalog=JSON.parse(fs.readFileSync(catalogPath));
    else {
      const stamp=Date.now();
      const airports=[];
      for(let i=0;i<20;i++) {
        const city=await flights.City.create({name:`K6-${stamp}-${i}`});
        const airport=await flights.Airport.create({name:`K6 airport ${i}`,cityId:city.id});
        airports.push(airport.id);
      }
      const plane=await flights.Airplane.create({modelNumber:'K6 fixture',capacity:300});
      const routes=Array.from({length:100},(_,i)=>({departureAirportId:airports[i%10],arrivalAirportId:airports[10+Math.floor(i/10)]}));
      for(let batch=0;batch<10;batch++) {
        await flights.Flight.bulkCreate(Array.from({length:1000},(_,j)=>{
          const i=batch*1000+j;
          return {...routes[i%100],flightNumber:`K6-${stamp}-${i}`,airplaneId:plane.id,
            departureTime:new Date(Date.UTC(2099,0,1+Math.floor(i/100))),
            arrivalTime:new Date(Date.UTC(2099,0,1+Math.floor(i/100),2)),price:2500+(i%10)*500,totalSeats:300};
        }));
      }
      const rows=await flights.Flight.findAll({where:{airplaneId:plane.id},attributes:['id'],order:[['id','ASC']]});
      const email=`k6-${stamp}@example.test`, password=`LocalK6-${stamp}!`;
      const user=await auth.User.create({email,password});
      catalog={routes,flightIds:rows.map(row=>row.id),airplaneId:plane.id,userId:user.id,email,password};
      fs.writeFileSync(catalogPath,JSON.stringify(catalog));
    }
    assert.equal(catalog.flightIds.length,10000);
    const fixturePath=path.join(local,`k6-${run}.json`);
    assert.ok(!fs.existsSync(fixturePath),`Run ${run} already exists; use a new run name.`);
    // Booking flights use the reverse route to keep search catalog cardinality stable.
    const route={departureAirportId:catalog.routes[0].arrivalAirportId,arrivalAirportId:catalog.routes[0].departureAirportId};
    const stamp=Date.now(); const bookingIds=[];
    for(let i=0;i<20;i++) {
      const flight=await flights.Flight.create({...route,flightNumber:`KB-${stamp}-${i}`,airplaneId:catalog.airplaneId,
        departureTime:'2099-01-01T10:00:00Z',arrivalTime:'2099-01-01T12:00:00Z',price:2500,totalSeats:300});
      bookingIds.push(flight.id);
    }
    const fixture={...catalog,bookingIds,initialSeats:300};
    fs.writeFileSync(fixturePath,JSON.stringify(fixture));
    return fixturePath;
  } finally {for(const db of dbs) await db.sequelize.close();}
}
module.exports={prepare};
if(require.main===module) prepare(process.argv[2]||'manual').then(file=>console.log(file)).catch(e=>{console.error(e.message);process.exitCode=1;});
