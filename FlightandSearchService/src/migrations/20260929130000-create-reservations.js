'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Reservations', {
      bookingId: {type: Sequelize.INTEGER, primaryKey: true, allowNull: false},
      flightId: {type: Sequelize.INTEGER, allowNull: false, references: {model: 'Flights', key: 'id'}, onDelete: 'RESTRICT', onUpdate: 'CASCADE'},
      noOfSeats: {type: Sequelize.INTEGER, allowNull: false},
      totalCost: {type: Sequelize.INTEGER, allowNull: false, defaultValue: 0},
      status: {type: Sequelize.ENUM('Reserved', 'Released', 'Rejected'), allowNull: false},
      createdAt: {type: Sequelize.DATE, allowNull: false},
      updatedAt: {type: Sequelize.DATE, allowNull: false}
    });
  },
  async down(queryInterface) { await queryInterface.dropTable('Reservations'); }
};
