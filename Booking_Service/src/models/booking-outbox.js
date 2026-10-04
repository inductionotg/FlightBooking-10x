module.exports=(sequelize,D)=>sequelize.define('BookingOutbox',{
  eventId:{type:D.STRING(80),primaryKey:true},bookingId:{type:D.INTEGER,allowNull:false,unique:true},
  payload:{type:D.JSON,allowNull:false},traceParent:{type:D.STRING(55),allowNull:true},publishedAt:{type:D.DATE,allowNull:true}
},{indexes:[{name:'outbox_unpublished',fields:['publishedAt','createdAt']}]});
