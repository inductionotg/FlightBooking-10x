const {sequelize, Flight, Reservation} = require('../models');
const {cache} = require('../utils/flight-cache');

function problem(statusCode, code, message) {
  return Object.assign(new Error(message), {statusCode, code});
}
function validate(data) {
  for (const field of ['bookingId', 'flightId', 'noOfSeats']) {
    if (!Number.isSafeInteger(data[field]) || data[field] <= 0 || data[field] > 2147483647) {
      throw problem(400, 'INVALID_RESERVATION', `${field} must be a positive integer`);
    }
  }
}

async function change(data, release = false) {
  validate(data);
  let changedFlight;
  const result = await sequelize.transaction(async transaction => {
    // Always lock flight before reservation: concurrent reservations serialize here.
    const flight = await Flight.findByPk(data.flightId, {transaction, lock: transaction.LOCK.UPDATE});
    if (!flight) throw problem(404, 'FLIGHT_NOT_FOUND', 'Flight not found');
    let reservation = await Reservation.findByPk(data.bookingId, {transaction, lock: transaction.LOCK.UPDATE});
    if (reservation && (reservation.flightId !== data.flightId || reservation.noOfSeats !== data.noOfSeats)) {
      throw problem(409, 'RESERVATION_CONFLICT', 'Booking ID already has a different reservation');
    }
    if (release) {
      if (!reservation) {
        // A cancellation arriving before reserve must also stop future delayed reserves.
        return Reservation.create({...data, totalCost: 0, status: 'Released'}, {transaction});
      }
      if (reservation.status === 'Reserved') {
        flight.totalSeats += reservation.noOfSeats;
        await flight.save({transaction});
        changedFlight = flight.toJSON();
      }
      reservation.status = 'Released';
      return reservation.save({transaction});
    }
    if (reservation) return reservation; // Retry: never deduct twice, including after release.
    if (flight.totalSeats < data.noOfSeats) {
      return Reservation.create({...data, totalCost: 0, status: 'Rejected'}, {transaction});
    }
    const totalCost = data.noOfSeats * flight.price;
    if (!Number.isSafeInteger(totalCost) || totalCost < 0 || totalCost > 2147483647) {
      throw problem(409, 'INVALID_FLIGHT_PRICE', 'Reservation cost is outside supported range');
    }
    flight.totalSeats -= data.noOfSeats;
    await flight.save({transaction});
    changedFlight = flight.toJSON();
    // If this insert fails, the seat deduction above is rolled back too.
    return Reservation.create({...data, totalCost, status: 'Reserved'}, {transaction});
  });
  // Only invalidate after COMMIT, and never reject a committed reservation for cache failure.
  if (changedFlight) await cache.invalidateFlights(changedFlight);
  return result;
}
module.exports = {reserve: data => change(data), release: data => change(data, true)};
