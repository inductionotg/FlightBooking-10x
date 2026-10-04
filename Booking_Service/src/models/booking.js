'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Booking extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Booking.init({
    notificationEmail: {type: DataTypes.STRING(254), allowNull: true},
    traceParent: {type: DataTypes.STRING(55), allowNull: true},
    requestKey: {type: DataTypes.STRING(64), allowNull: true, unique: true},
    cancelRequested: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
    reservationReleased: {type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false},
    failureCode: {type: DataTypes.STRING(64), allowNull: true},
    nextAttemptAt: {type: DataTypes.DATE, allowNull: true},
    flightId: {
      type:DataTypes.INTEGER,
      allowNull:false
    },
    userId:{
      type: DataTypes.INTEGER,
      allowNull:false
    },
    status:{
      type: DataTypes.ENUM,
      allowNull:false,
      values:['InProcess','Booked','Cancelled'],
      defaultValue:'InProcess'
    },
    noOfSeats:{
      type:DataTypes.INTEGER,
      allowNull:false,
      defaultValue:1
    },
    totalCost:{
      type:DataTypes.INTEGER,
      allowNull:false,
      defaultValue:0
    }
  }, {
    sequelize,
    modelName: 'Booking',
  });
  return Booking;
};
