const jwt = require('jsonwebtoken')
const UserRepository = require('../repository/user-repository')
const { AUTH_KEY } = require('../config/serverConfig')
const bcrypt = require('bcrypt')
class UserServices{
    constructor(){
        this.userRepository = new UserRepository()
    }
    async create(data){
        try{
            const user = await this.userRepository.createUser(data);
            return user;
        }catch(error){
            if(error.name === 'SequelizeValidationError'){
                throw error
            }
            throw error;
        }
    }

    async destroy(id){
        try {
            const response = await this.userRepository.destroy(id);
            return response;
        } catch (error) {
            throw error;
        }
    }
    async getUserById(id){
        try {
            const response = await this.userRepository.getUserById(id)
            return response
        } catch (error) {
            if(error.name === 'UserNullFound'){
                throw error
            }
            throw error;
        }
    }
    async signIn(email,planPassword){
        try {
            //Step-1 --> get the userEmail and password from the user. we are getting full object of user or fetch the user using email
            const user = await this.userRepository.getUserByEmail(email)
            //STEP-2 --> COMPARE INCOMING PLAINpassword with the encrypted password
            const passwordMatched = this.checkPassword(planPassword,user.password)
            if(!passwordMatched){
                throw {error:"password not matched"}
            }
            //step-3 --> If passwords match then create a token and send it to the user
            const newJWT = this.createToken({email:user.email,id:user.id}) 
            return newJWT
        } catch (error) {
            if(error.name ==='AttributeNotFound'){
                throw error
            }
            throw error;
        }
    }
    async isAuthenticated(token){
        try {
            const response = this.verifyToken(token)
            if(!response){
                throw {error:"Invalid token"}
            }
            const user = await this.userRepository.getUserById(response.id)
            if(!user){
                throw {error:"No user with corressponding ID"}
            }

            return user.id
        } catch (error) {

            throw error;
        }
    }
    createToken(user){
        try {
            const jwtToken = jwt.sign(user,AUTH_KEY,{expiresIn:'1h'})
            return jwtToken
        } catch (error) {
            throw {error};
        }
    }

     verifyToken(token){
        try {
            const verify = jwt.verify(token,AUTH_KEY)
            return verify
        } catch (error) {

            throw error;
        }
    }

    checkPassword(userInputPlainPassword,encryptedPassword){
        try {
            const compare = bcrypt.compareSync(userInputPlainPassword,encryptedPassword)
            return compare
        } catch (error) {
            throw error;
        }
    }
    async isAdmin(userId){
        try {
            return  await this.userRepository.isAdmin(userId)
        } catch (error) {
            throw error;
        }
    }
}

module.exports = UserServices