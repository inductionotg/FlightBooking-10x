// Add 100 repeatable sample flights through the authenticated flight-service API.
// Airport and airline names/codes are real; flight numbers, dates and fares are fictional.
const base = (process.env.FLIGHT_API_URL || 'http://[::1]:3002/api/v1').replace(/\/$/, '');
const {adminToken} = require('./local-auth');
const fs = require('node:fs');
const path = require('node:path');
let token;

const places = [
  { city: 'Delhi', code: 'DEL', airport: 'Indira Gandhi International Airport (DEL)' },
  { city: 'Mumbai', code: 'BOM', airport: 'Chhatrapati Shivaji Maharaj International Airport (BOM)' },
  { city: 'Bengaluru', code: 'BLR', airport: 'Kempegowda International Airport Bengaluru (BLR)' },
  { city: 'Hyderabad', code: 'HYD', airport: 'Rajiv Gandhi International Airport (HYD)' },
  { city: 'Chennai', code: 'MAA', airport: 'Chennai International Airport (MAA)' },
  { city: 'Kolkata', code: 'CCU', airport: 'Netaji Subhas Chandra Bose International Airport (CCU)' }
];

const routes = [
  { number: 'AI 9101', from: 'DEL', to: 'BOM', hour: 9, minute: 0, duration: 130, price: 5400 },
  { number: '6E 9201', from: 'BOM', to: 'BLR', hour: 11, minute: 15, duration: 110, price: 3900 },
  { number: 'QP 9301', from: 'BLR', to: 'HYD', hour: 13, minute: 30, duration: 75, price: 3200 },
  { number: '6E 9202', from: 'HYD', to: 'MAA', hour: 15, minute: 0, duration: 80, price: 3400 },
  { number: 'AI 9102', from: 'MAA', to: 'CCU', hour: 7, minute: 45, duration: 135, price: 5600 },
  { number: 'QP 9302', from: 'CCU', to: 'DEL', hour: 16, minute: 30, duration: 145, price: 6100 },
  { number: '6E 9203', from: 'DEL', to: 'BLR', hour: 12, minute: 30, duration: 170, price: 4800 },
  { number: 'AI 9103', from: 'BOM', to: 'DEL', hour: 18, minute: 0, duration: 125, price: 5200 }
];

// Approximate demo durations in minutes; these are not airline schedules.
const durations = {
  'BOM-DEL': 130, 'BLR-DEL': 170, 'DEL-HYD': 135, 'DEL-MAA': 175, 'CCU-DEL': 145,
  'BLR-BOM': 110, 'BOM-HYD': 95, 'BOM-MAA': 125, 'BOM-CCU': 160,
  'BLR-HYD': 75, 'BLR-MAA': 60, 'BLR-CCU': 150, 'HYD-MAA': 80,
  'CCU-HYD': 130, 'CCU-MAA': 135
};
const directedRoutes = places.flatMap(origin => places.filter(destination => destination.code !== origin.code)
  .map(destination => ({ from: origin.code, to: destination.code })));
for (let i = 0; routes.length < 100; i++) {
  const route = directedRoutes[i % directedRoutes.length];
  const duration = durations[[route.from, route.to].sort().join('-')];
  if (!duration) throw new Error(`Missing demo duration for ${route.from}-${route.to}`);
  routes.push({ ...route, number: `${['AI', '6E', 'QP'][i % 3]} ${9600 + i}`,
    hour: 6 + (i * 3) % 16, minute: (i % 4) * 15, duration,
    dayOffset: Math.floor(i / directedRoutes.length), price: 2800 + Math.floor(duration / 10) * 150 + (i % 7) * 200 });
}
const airlineNames = {AI:'Air India', '6E':'IndiGo', QP:'Akasa Air'};
function writeSchedule(flights) {
  const format = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Kolkata', year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const csv = value => '"' + String(value).replaceAll('"', '""') + '"';
  const rows = [['flightNumber','airline','from','originCity','originAirport','to','destinationCity','destinationAirport','departureIST','arrivalIST','fareINR','availableSeats']];
  for (const {route, flight} of flights) {
    const origin = places.find(place => place.code === route.from);
    const destination = places.find(place => place.code === route.to);
    rows.push([flight.flightNumber, airlineNames[flight.flightNumber.split(' ')[0]], route.from, origin.city, origin.airport,
      route.to, destination.city, destination.airport, format.format(new Date(flight.departureTime)),
      format.format(new Date(flight.arrivalTime)), flight.price, flight.totalSeats]);
  }
  fs.writeFileSync(path.join(__dirname, '../docs/demo-flight-schedule.csv'), rows.map(row => row.map(csv).join(',')).join('\n') + '\n');
}

async function api(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json', 'x-access-token': token } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false || result.sucess === false) {
    throw new Error(`${path}: ${result.message || response.status}`);
  }
  return result.data;
}

function flightTimes(route, date) {
  // Added sample departures span four days, starting seven days after seeding in India time.
  const utc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + (route.dayOffset || 0), route.hour - 5, route.minute - 30);
  const departure = new Date(utc);
  return { departureTime: departure.toISOString(), arrivalTime: new Date(utc + route.duration * 60000).toISOString() };
}

async function main() {
  token = await adminToken();
  const catalog = await api('/catalog');
  if (!catalog || !Array.isArray(catalog.cities) || !Array.isArray(catalog.airports) || !Array.isArray(catalog.airplanes)) {
    throw new Error('Flight service catalog response is missing; start the updated backend first.');
  }
  const counts = { cities: 0, airports: 0, airplanes: 0, flights: 0, skippedFlights: 0 };
  const airportIds = {};
  for (const place of places) {
    let city = catalog.cities.find(item => item.name.toLowerCase() === place.city.toLowerCase());
    if (!city) { city = await api('/city', { name: place.city }); catalog.cities.push(city); counts.cities++; }
    let airport = catalog.airports.find(item => item.name.toLowerCase() === place.airport.toLowerCase());
    if (!airport) {
      airport = await api('/airports', { name: place.airport, cityId: city.id });
      catalog.airports.push(airport); counts.airports++;
    } else if (Number(airport.cityId) !== Number(city.id)) {
      throw new Error(`${place.airport} already belongs to another city; refusing to change it.`);
    }
    airportIds[place.code] = airport.id;
  }

  let airplane = catalog.airplanes.find(item => item.modelNumber === 'Airbus A320neo (demo cabin)');
  if (!airplane) {
    airplane = await api('/airplanes', { modelNumber: 'Airbus A320neo (demo cabin)', capacity: 180 });
    counts.airplanes++;
  }
  const date = new Date(Date.now() + 330 * 60000); // India calendar date, independent of host timezone.
  date.setUTCDate(date.getUTCDate() + 7);
  const existingRoutes = new Map();
  const schedule = [];
  for (const route of routes) {
    const departureAirportId = airportIds[route.from];
    const arrivalAirportId = airportIds[route.to];
    const query = new URLSearchParams({ departureAirportId, arrivalAirportId });
    const routeKey = `${route.from}-${route.to}`;
    if (!existingRoutes.has(routeKey)) existingRoutes.set(routeKey, await api(`/flights?${query}`));
    const existing = existingRoutes.get(routeKey);
    const saved = existing.find(flight => flight.flightNumber === route.number);
    if (saved) { counts.skippedFlights++; schedule.push({route, flight:saved}); continue; }
    const flight = await api('/flights', {
      flightNumber: route.number, airplaneId: airplane.id, departureAirportId, arrivalAirportId,
      ...flightTimes(route, date), price: route.price
    });
    existing.push(flight);
    schedule.push({route, flight});
    counts.flights++;
  }
  writeSchedule(schedule);
  console.log(`Demo catalog ready (100 flights across 30 directed routes; CSV: docs/demo-flight-schedule.csv): ${JSON.stringify(counts)}. Cities and airports are real; flight schedules and fares are fictional.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
