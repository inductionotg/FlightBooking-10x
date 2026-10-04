const { AirplaneRepository, FlightRepository } = require('../repository/index')
const { compareTime } = require('../utils/helper')
const {cache, searchKey} = require('../utils/flight-cache')
class FlightService {

    constructor(){
        this.AirplaneRepository = new AirplaneRepository();
        this.FlightRepository = new FlightRepository();
    }
    async createFlight(data){
        try {
            if(!compareTime(data.arrivalTime,data.departureTime)){
                throw {error:"Arrival Time cannot be less than departure Time"}
            }
            const airplaneCapacity = await this.AirplaneRepository.getAirplane(data.airplaneId)
            const flight = await this.FlightRepository.createFlight(
                {...data,totalSeats:airplaneCapacity.capacity})
            await cache.invalidateFlights(flight)
            return flight
        } catch (error) {
            throw {error}
        }
        
    }

    async getFlight(data){
        try {
            const id = Number(data)
            const scope = /^\d+$/.test(String(data)) && Number.isSafeInteger(id) && id > 0 ? `flight:${id}` : null
            const flight = await cache.read(scope, scope ? id : String(data), () => this.FlightRepository.getFlight(data))
            return flight
        } catch (error) {
            throw error
        }
    }

    async getAllFlight(data){
        try {
            const key = searchKey(data)
            const flight = await cache.read(key?.scope || null, key?.filters || data,
                () => this.FlightRepository.getAllFlight(data))
            return flight
        } catch (error) {
            throw error
        }
    }

    async updateFlight(flightId,data){
        try {
            const update = await this.FlightRepository.update(flightId,data)
            await cache.invalidateFlights(update.before, update.after)
            return update.updated
        } catch (error) {
            throw error
        }
    }
}
module.exports = FlightService

/**
 * {
 * flightNumber,
 * airplaneId,
 * departureAirportId,
 * arrivalAirportId,
 * arrivalTime
 * departureTime,
 * price,
 * totalSeats -> airplane
 * }
 */
