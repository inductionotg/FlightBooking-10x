
const { FlightService } = require('../services/index')
const {SucessCodes} = require('../utils/error-codes')
const flightService = new FlightService();

const create = async(req,res)=>{
    try {
        /**
         * Current we are directly passing req.body , but we should not do this.Lets say in middleware we are filtering out the mandatory fields
         * but what about non-mandatory fields and user is sendind that also and bloating the request.body.
         * So we are creating a object 
         * If user send some random data and making overall request bulky and I dont want that to expose to my serice layer and repository layer
         * Its a good practice to destructure the request.body atleast in the create API
         */
        const flightRequestData={
            flightNumber:req.body.flightNumber,
            airplaneId:req.body.airplaneId,
            departureAirportId:req.body.departureAirportId,
            arrivalAirportId:req.body.arrivalAirportId,
            arrivalTime:req.body.arrivalTime,
            departureTime:req.body.departureTime,
            price:req.body.price
        }
        const flight = await flightService.createFlight(flightRequestData)
        return res.status(SucessCodes.CREATED).json({
            data:flight,
            err:{},
            success:true,
            message:"Successfully created the flight"
        })
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(500).json({
            data:{},
            success:false,
            message:"Not created flight",
            err:{error}
        })
    }
}

const getFlight = async(req,res)=>{
    try {
        const flight = await flightService.getFlight(req.params.id)
        return res.status(SucessCodes.OK).json({
            data:flight,
            err:{},
            success:true,
            message:"Successfully created the flight"
        })
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(error.statusCode || 500).json({
            data:{},
            success:false,
            message:"Not created flight",
            err:{error}
        })
    }
}

const getAllFlight = async(req,res)=>{
    try {
        const flight = await flightService.getAllFlight(req.query)
        return res.status(SucessCodes.OK).json({
            data:flight,
            err:{},
            success:true,
            message:"Successfully Fetched all the flight"
        })
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(error.statusCode || 500).json({
            data:{},
            success:false,
            message:"Not fetched  flight",
            err:{error}
        })
    }
}

const updateFlight = async(req,res)=>{
    try {
        const flight = await flightService.updateFlight(req.params.id,req.body)
        return res.status(SucessCodes.OK).json({
            data:flight,
            err:{},
            success:true,
            message:"Successfully updated the flight"
        })
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(error.statusCode || 500).json({
            data:{},
            success:false,
            message:"Not updated  flight",
            err:error
        })
    }
}

module.exports = {
    create,
    getFlight,
    getAllFlight,
    updateFlight
}
