// Test-only process: exit after the remote reservation commits but before booking confirmation.
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require(path.join(root, 'Booking_Service/node_modules/dotenv')).config({path:path.join(root, 'Booking_Service/.env')});
const axios = require(path.join(root, 'Booking_Service/node_modules/axios/dist/node/axios.cjs'));
const BookingService = require(path.join(root, 'Booking_Service/src/services/booking-service'));
const payload = JSON.parse(process.argv[2]);
new BookingService({flightClient:{post:async (...args) => {
  await axios.post(...args);
  process.exit(86);
}}}).createBooking(payload.data, payload.key).catch(() => process.exit(87));
