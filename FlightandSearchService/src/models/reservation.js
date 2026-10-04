'use strict';
module.exports = (sequelize, DataTypes) => sequelize.define('Reservation', {
  bookingId: {type: DataTypes.INTEGER, primaryKey: true, allowNull: false},
  flightId: {type: DataTypes.INTEGER, allowNull: false},
  noOfSeats: {type: DataTypes.INTEGER, allowNull: false},
  totalCost: {type: DataTypes.INTEGER, allowNull: false, defaultValue: 0},
  status: {type: DataTypes.ENUM('Reserved', 'Released', 'Rejected'), allowNull: false}
});
