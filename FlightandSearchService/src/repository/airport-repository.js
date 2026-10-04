//const {Airport} = require('../models/index')

const  CrudRepository  = require('./crud-repository')
const { Airport } = require('../models/index')
class AirportRepository extends CrudRepository{

    /*
    -Below approach is also correct but now I am using a base crud repository so that
    -repeatation of code will not happen
    - I am using inheritance here and calling base class using super
    - I can create my method and It will override the base class method
    - For example .. if i have a specific 'UPDATE' function then it will not call the common upadte function , it will call my specific update function
    -and this it will method override
    - async update(){
        It will call this specific update my function
    }
    --If you want cutomisation then just override the function
    async createAirport(data){
        try {
            const airport = await Airport.create({name:data.name,address:data.address,cityId:data.cityId })
            return airport
        } catch (error) {
            throw {error}
        }
    }
    */
    constructor(){
        super(Airport);
    }
}

module.exports=AirportRepository