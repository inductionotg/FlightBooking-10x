const { User,Role } = require('../models/index')
const ClientError = require('../utils/client-error')
const ValidationError = require('../utils/validation-error')
const { StatusCodes } = require('http-status-codes')
class UserRepository{

    async createUser(data){
        try {
            const user =await User.create(data)
            return user
        } catch (error) {
            //console.log(error)
            if(error.name === 'SequelizeValidationError'){
                let validationError = new ValidationError(error) // or new ValidationError(error)
                throw validationError
            }
            throw error
        }
    }

    async destroy(userId){
        try {
            await User.destroy({
                where:{
                    id:userId
                }
            })
            return true
        } catch (error) {
            throw error
        }
    }

    async getUserById(userId){
        try {
            const user = await User.findByPk(userId,{
                attributes: ['email', 'id']
            })
            if(user===null){
               throw new ClientError(
                'UserNullFound',
                'No user Found',
                "UserId Not Found",
                StatusCodes.NOT_FOUND
               )
            }
            return user
        } catch (error) {

            throw error
        }
    }
    async getPrincipalById(userId) {
        const user = await User.findByPk(userId, {
            attributes: ['id', 'email'],
            include: [{ model: Role, attributes: ['name'], through: { attributes: [] } }]
        });
        if (!user) return null;
        return { id: user.id, email: user.email, roles: user.Roles.map(role => role.name) };
    }
    async getUserByEmail(userEmail){
        try {
            const userByEmail = await User.findOne({
                where:{
                    email:userEmail
                }
            })
            if(!userByEmail){
                throw new ClientError(
                    'AttributeNotFound',
                    "No email Found in the record",
                    "No email exist",
                    StatusCodes.NOT_FOUND
                )
            }
            return userByEmail
        } catch (error) {

            throw error
        }
    }
    async isAdmin(userId){
        const principal = await this.getPrincipalById(userId)
        return Boolean(principal && principal.roles.includes('ADMIN'))
    }
}

module.exports=UserRepository
