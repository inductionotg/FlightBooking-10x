const {clientError} = require('../utils/error-codes')
const createValidateFlight = (req,res,next)=>{
    if(
        !req.body.flightNumber ||
        !req.body.airplaneId ||
        !req.body.departureAirportId ||
        !req.body.arrivalAirportId ||
        !req.body.arrivalTime ||
        !req.body.departureTime ||
        !req.body.price
    ){
        //If any of the body params is missing we come inside the if
        return res.status(clientError.BAD_REQUEST).json({
            data:{},
            success:false,
            message:'Invalid request body for create Flight',
            err:"Mandatory fields are not present"
        })
    }
    next()

}

module.exports = {
    createValidateFlight
}