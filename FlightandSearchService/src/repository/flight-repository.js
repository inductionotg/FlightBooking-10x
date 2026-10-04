const { Flight, Reservation, sequelize } = require('../models/index')
const { Op } = require('sequelize')
class FlightRepository {

    /**
     * Why createFilter in repository?
     * Because I am still using database  const --{ Op } = require('sequelize') 
     * I can do in service section also but i am using sequelize operator , so thats why using in repository section
     */
    #createFilter(data){
        let filter = {}
        //console.log("...",filter)
        
        if(data.arrivalAirportId){
            filter.arrivalAirportId = data.arrivalAirportId
        }

        if(data.departureAirportId){
            filter.departureAirportId = data.departureAirportId
        }
        /*
        if(data.minPrice && data.maxPrice){
            Object.assign(filter,{
                [Op.and]:[
                    {price:{[Op.lte]:data.maxPrice}},
                    {price:{[Op.gte]:data.minPrice}}
                ]
            })
        }

        Why not using above if stmt because it is adding extra nested filter so that's why we are using PriceFilter array
        */
        let pricefilter=[]
        if(data.minPrice){
            pricefilter.push({price:{[Op.gte]:data.minPrice}})
        }
        if(data.maxPrice){
            pricefilter.push({price:{[Op.lte]:data.maxPrice}})
        }
        /*
        if(data.minPrice){
            Object.assign(filter,{price:{[Op.gte]:data.minPrice}})
        }

        if(data.maxPrice){
            Object.assign(filter,{price:{[Op.lte]:data.minPrice}})
        }
        */
        Object.assign(filter,{[Op.and]:pricefilter})

        return filter

    }

    async createFlight(data){
        try {
            const flight = await Flight.create(data)
            return flight;
        } catch (error) {
            throw {error};
        }
    }

    async getFlight(flightId){
        try {
            const flight = await Flight.findByPk(flightId)
            return flight
        } catch (error) {
            throw error;
        }
    }

    async getAllFlight(filter){
        try {
            const filterObject = await this.#createFilter(filter)
            const flight = await Flight.findAll({
                where:filterObject
            })
            return flight
        } catch (error) {
            throw error;
        }
    }

    async update(flightId,data){
        try {
            return sequelize.transaction(async transaction => {
                const flight = await Flight.findByPk(flightId, {transaction, lock: transaction.LOCK.UPDATE});
                if (!flight) throw Object.assign(new Error('Flight not found'), {statusCode: 404});
                const before = flight.toJSON();
                if (Object.prototype.hasOwnProperty.call(data, 'totalSeats')) {
                    const seats = Number(data.totalSeats);
                    if (!Number.isSafeInteger(seats) || seats < 0 || seats > 2147483647) {
                        throw Object.assign(new Error('Invalid seat count'), {statusCode: 400});
                    }
                    const active = await Reservation.count({where: {flightId, status: 'Reserved'}, transaction});
                    if (active) throw Object.assign(new Error('Cannot overwrite inventory with active reservations'), {statusCode: 409});
                    data = {...data, totalSeats: seats};
                }
                await flight.update(data, {transaction});
                return {updated: true, before, after: flight.toJSON()};
            });
        } catch (error) {
            throw error;
        }
    }

}
module.exports = FlightRepository
