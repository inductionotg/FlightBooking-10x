const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const report = {timestamp:new Date().toISOString(), checks:[], scope:'Local functional smoke test; not a load test or payment/email delivery test.'};
async function request(name, port, route, options = {}) {
  const response = await fetch(`http://[::1]:${port}${route}`, {
    ...options, signal:AbortSignal.timeout(10000),
    headers:{'content-type':'application/json', ...options.headers}
  });
  const body = await response.text();
  report.checks.push({name, status:response.status});
  assert.ok(response.ok, `${name}: HTTP ${response.status}`);
  const json = JSON.parse(body);
  assert.equal(json.success, true, name);
  return json.data;
}
const post = body => ({method:'POST', body:JSON.stringify(body)});
async function main() {
  const suffix = Date.now();
  // Use only the dedicated local database created by setup-local.js.
  const config = require(path.join(root, 'FlightandSearchService/src/config/config.json')).development;
  assert.equal(config.database, 'baseline_flights');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 33306);
  const db = require(path.join(root, 'FlightandSearchService/src/models'));
  try {
    const email = `smoke-${suffix}@example.test`;
    const password = `LocalSmoke-${suffix}!`;
    const user = (await request('signup', 3001, '/api/v1/signup', post({email,password}))).response;
    const token = await request('sign-in', 3001, '/api/v1/signIn', post({email,password}));
    const headers = {'x-access-token':token};
    const authenticated = await request('authentication', 3001, '/api/v1/isAuthenticated', {headers});
    assert.equal(authenticated.response, user.id);
    const origin = await db.City.create({name:`Smoke origin ${suffix}`});
    const destination = await db.City.create({name:`Smoke destination ${suffix}`});
    const a = await db.Airport.create({name:'Smoke airport A', cityId:origin.id});
    const b = await db.Airport.create({name:'Smoke airport B', cityId:destination.id});
    const airplane = await db.Airplane.create({modelNumber:'Smoke aircraft', capacity:10});
    const flight = await request('create-flight', 3002, '/api/v1/flights', post({
      flightNumber:`SM${suffix}`, airplaneId:airplane.id, departureAirportId:a.id,
      arrivalAirportId:b.id, departureTime:'2099-01-01T10:00:00Z',
      arrivalTime:'2099-01-01T12:00:00Z', price:2500
    }));
    const flights = await request('search-flight', 3002, `/api/v1/flights?departureAirportId=${a.id}&arrivalAirportId=${b.id}`);
    assert.ok(flights.some(item => item.id === flight.id));
    const booking = await request('create-booking', 3003, '/api/v1/booking', post({flightId:flight.id,userId:user.id,noOfSeats:2}));
    assert.equal(booking.status, 'Booked');
    assert.equal(booking.totalCost, 5000);
    const after = await request('verify-remaining-seats', 3002, `/api/v1/flights/${flight.id}`);
    assert.equal(after.totalSeats, 8);
    const ticket = await request('create-notification-ticket', 3004, '/api/v1/createticket', post({
      subject:'Local smoke test', content:'No email should be sent',
      recepientEmail:email, notificationTime:'2099-01-01T00:00:00Z'
    }));
    assert.ok(ticket.id);
    await request('delete-notification-ticket', 3004, `/api/v1/deleteticket/${ticket.id}`, {method:'DELETE'});
    const gatewayFlight = await request('gateway-flight-route', 3010, `/flightService/api/v1/flights/${flight.id}`, {headers});
    assert.deepEqual(gatewayFlight, after);
    const gatewayFlights = await request('gateway-search-filters', 3010, `/flightService/api/v1/flights?departureAirportId=${a.id}&arrivalAirportId=${b.id}&minPrice=2400&maxPrice=2600`, {headers});
    assert.deepEqual(gatewayFlights.map(item => item.id), [flight.id]);
    const excludedFlights = await request('gateway-search-excludes-price', 3010, `/flightService/api/v1/flights?departureAirportId=${a.id}&minPrice=2600`, {headers});
    assert.deepEqual(excludedFlights, []);
    for (const [name, authHeaders] of [['gateway-missing-token', {}], ['gateway-invalid-token', {'x-access-token':'invalid-smoke-token'}]]) {
      const response = await fetch(`http://[::1]:3010/flightService/api/v1/flights/${flight.id}`, {headers:authHeaders, signal:AbortSignal.timeout(10000)});
      report.checks.push({name,status:response.status});
      await response.text();
      assert.equal(response.status, 401, name);
    }
    report.booking = {id:booking.id,flightId:flight.id,status:booking.status,totalCost:booking.totalCost,seatsBefore:flight.totalSeats,seatsAfter:after.totalSeats};
    report.directServiceFlowPassed = true;
    report.gatewayPassed = true;
  } finally { await db.sequelize.close(); }
}
main().catch(error => { report.error = error.message; process.exitCode = 1; }).finally(() => {
  fs.mkdirSync(path.join(root, 'docs'), {recursive:true});
  fs.writeFileSync(path.join(root, 'docs/step-1-smoke-results.json'), JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
});
