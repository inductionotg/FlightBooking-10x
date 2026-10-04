const { AirportRepository } = require('../repository/index')
const CrudService = require('./crud-service')
class AirportService extends CrudService{

    /*

    -Below Approach is also correct
    -I am writing , a base class called crud-service, so that we donot do method overriding
    - It is the enhancement 
    - 
    constructor(){
        this.AirportRepository = new AirportRepository();
    }

    async createAirport(data){
        try {
            const airport = this.AirportRepository.createAirport(data)
            return airport
        } catch (error) {
            throw {error}
        }

    }
    */
   constructor(){
    const airportRepository = new AirportRepository();
    super(airportRepository)
   }
}

module.exports=AirportService