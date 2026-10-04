const { AirportService } = require('../services/index')


const airportService = new AirportService()

const create =async(req,res)=>{
    try {
        const response = await airportService.create(req.body)
        return res.status(201).json({
            data:response,
            success:true,
            message:'Successfully created the airport',
            err:{}
        })
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(500).json({
            data:{},
            success:false,
            err:error,
            message:'Cannot create new airport'
        })
    }
}

/*
const createAirport = async(req,res)=>{
    try {
        const airport = await airportService.createAirport(req.body)
        return res.status(201).json({
            sucess:true,
            data:airport,
            message:'successfully created the city',
            error:{}
        })
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(500).json({
            sucess:false,
            err:error,
            message:"Not able to create the city",
            date:{}
        })
    }
}
*/
module.exports={
    create
}