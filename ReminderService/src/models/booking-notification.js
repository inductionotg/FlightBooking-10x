module.exports=(sequelize,D)=>sequelize.define('BookingNotification',{
  eventId:{type:D.STRING(80),primaryKey:true},bookingId:{type:D.INTEGER,allowNull:false,unique:true},
  payload:{type:D.JSON,allowNull:false},traceParent:{type:D.STRING(55),allowNull:true},status:{type:D.STRING(32),allowNull:false},
  attempts:{type:D.INTEGER,allowNull:false,defaultValue:0},availableAt:{type:D.DATE,allowNull:false},
  leaseUntil:{type:D.DATE,allowNull:true},leaseToken:{type:D.STRING(36),allowNull:true}
},{indexes:[{name:'booking_notifications_due',fields:['status','availableAt']}]});
