'use strict';
const {
  Model
} = require('sequelize');
//const {SALT} = require('../config/serverConfig')

const bcrypt = require('bcrypt')
const SALT = bcrypt.genSaltSync(10)
module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
       /*
      this.belongsToMany(models.User,{
        through:'User_Roles'
        --> we can use this also because this refers to user class
      */

      User.belongsToMany(models.Role,{
        through:'User_Roles'
      })
    }
  }
  User.init({
    email:
    {
      type: DataTypes.STRING,
      allowNull:false,
      unique:true,
      validate:{
        isEmail:true
      }
    },
    password:
    { 
     type:DataTypes.STRING,
     allowNull:false,
     validate:{
      len:[3,100],
      notIn:[['password','123456','abc']]
    }
    }
  }, {
    sequelize,
    modelName: 'User',
  });
  User.beforeCreate((user)=>{
    /**
     * user--> This user object is the same object that we are trying to create
     * beforeCreate is a trigger method in sequelize which is used to trigger
     * something before creation
     */
    const encryptedPassword = bcrypt.hashSync(user.password,SALT)
    user.password = encryptedPassword
  })
  return User;
};