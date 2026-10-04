'use strict';

const name = 'flights_route_price_idx';
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('Flights', ['departureAirportId', 'arrivalAirportId', 'price'], {name});
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('Flights', name);
  }
};
