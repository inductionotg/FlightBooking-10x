const {StatusCodes} = require('http-status-code')
const { Booking } = require('../models/index')
const {AppError,ValidationError,ServiceError} = require('../utils/errors/index')
class BookingRepository{

    async createBooking(data){
        try {
            const booking = await Booking.create(data)
            return booking
        } catch (error) {
            if(error.name === 'SequelizeValidationError'){
                throw new ValidationError(error)
            }
            throw new AppError(
                'RepositoryError',
                'Cannot create booking',
                'There was some issue creating the booking, Please try again later',
                StatusCodes.INTERNAL_SERVER_ERROR
            )
        }
    }

    async update(flightId,data){
        try {
            /*
            const response = await Booking.update(data,{
                where:{
                    id:flightId
                }
            })
            return true
            The above method is also correct to update the booking status but it will not return any response objects
            */
            
            const response = await Booking.findByPk(flightId)
            if(data.status){
                response.status = data.status
            }
            await response.save()
            return response
            /**
             * Above method is also correct to update the booking status, only difference is that it will return the response object
             */
        } catch (error) {
            throw new AppError(
                'RepositoryError',
                'Cannot create booking',
                'There was some issue creating the booking, Please try again later',
                StatusCodes.INTERNAL_SERVER_ERROR
            )
        }
    }
}

module.exports = BookingRepository