'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Bookings', 'requestKey', {type: Sequelize.STRING(64), allowNull: true});
    await queryInterface.addIndex('Bookings', ['requestKey'], {unique: true, name: 'bookings_request_key_unique'});
    await queryInterface.addColumn('Bookings', 'cancelRequested', {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false});
    await queryInterface.addColumn('Bookings', 'reservationReleased', {type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false});
    await queryInterface.addColumn('Bookings', 'failureCode', {type: Sequelize.STRING(64), allowNull: true});
    await queryInterface.addColumn('Bookings', 'nextAttemptAt', {type: Sequelize.DATE, allowNull: true});
    await queryInterface.addIndex('Bookings', ['nextAttemptAt', 'id'], {name: 'bookings_recovery_due'});
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('Bookings', 'bookings_recovery_due');
    await queryInterface.removeIndex('Bookings', 'bookings_request_key_unique');
    for (const column of ['nextAttemptAt', 'failureCode', 'reservationReleased', 'cancelRequested', 'requestKey']) {
      await queryInterface.removeColumn('Bookings', column);
    }
  }
};
