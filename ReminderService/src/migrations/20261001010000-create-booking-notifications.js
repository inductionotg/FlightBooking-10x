'use strict';
module.exports={
  async up(q,S){
    await q.createTable('BookingNotifications',{
      eventId:{type:S.STRING(80),primaryKey:true},bookingId:{type:S.INTEGER,allowNull:false,unique:true},
      payload:{type:S.JSON,allowNull:false},traceParent:{type:S.STRING(55),allowNull:true},
      status:{type:S.STRING(32),allowNull:false},attempts:{type:S.INTEGER,allowNull:false,defaultValue:0},
      availableAt:{type:S.DATE,allowNull:false},leaseUntil:{type:S.DATE,allowNull:true},leaseToken:{type:S.STRING(36),allowNull:true},
      createdAt:{type:S.DATE,allowNull:false},updatedAt:{type:S.DATE,allowNull:false}
    });
    await q.addIndex('BookingNotifications',['status','availableAt'],{name:'booking_notifications_due'});
  },
  async down(q){await q.dropTable('BookingNotifications');}
};
