'use strict';
module.exports={
  async up(q,S){
    await q.addColumn('Bookings','notificationEmail',{type:S.STRING(254),allowNull:true});
    await q.addColumn('Bookings','traceParent',{type:S.STRING(55),allowNull:true});
    await q.createTable('BookingOutboxes',{
      eventId:{type:S.STRING(80),primaryKey:true},bookingId:{type:S.INTEGER,allowNull:false,unique:true},
      payload:{type:S.JSON,allowNull:false},traceParent:{type:S.STRING(55),allowNull:true},
      publishedAt:{type:S.DATE,allowNull:true},createdAt:{type:S.DATE,allowNull:false},updatedAt:{type:S.DATE,allowNull:false}
    });
    await q.addIndex('BookingOutboxes',['publishedAt','createdAt'],{name:'outbox_unpublished'});
  },
  async down(q){await q.dropTable('BookingOutboxes');await q.removeColumn('Bookings','traceParent');await q.removeColumn('Bookings','notificationEmail');}
};
