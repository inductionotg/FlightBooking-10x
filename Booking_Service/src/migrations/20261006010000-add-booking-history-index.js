'use strict';
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex('Bookings', ['userId','id'], {name:'bookings_user_id_history'});
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('Bookings', 'bookings_user_id_history');
  }
};
