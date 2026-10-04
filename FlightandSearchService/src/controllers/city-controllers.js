const { CityService } = require('../services/index')

const cityService = new CityService() //why? because CityService is a class and we have to make it a object
//console.log(cityService)

const create=async(req,res)=>{
    try {
        const city = await cityService.createCity(req.body)
        return res.status(201).json({
            sucess:true,
            data:city,
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

const destroy=async(req,res)=>{
    try {
        const response = await cityService.destroyCity(req.params.id)
        return res.status(200).json({
            sucess:true,
            data:response,
            message:'successfully deleted the city',
            error:{}
        })
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(500).json({
            sucess:false,
            err:error,
            message:"Not able to delete the city",
            error:{}
        })
    }
}

const update = async(req,res)=>{
    try {
        const city = await cityService.updateCity(req.params.id,req.body)
        return res.status(200).json({
            sucess:true,
            data:city,
            message:'successfully updated the city',
            error:{}
        })
        
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(500).json({
            sucess:false,
            err:error,
            message:"Not able to update the city",
            error:{}
        })
        
    }
}

const getCity = async(req,res)=>{
    try {
        const city = await cityService.getCity(req.params.id)
        return res.status(200).json({
            sucess:true,
            data:city,
            message:'successfully got the city',
            error:{}
        })
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(500).json({
            sucess:false,
            err:error,
            message:"Not able to got the city",
            error:{}
        })
        
    }
}

const getAllCity = async(req,res)=>{
    try {
        const city = await cityService.getAllCity(req.query)
        return res.status(200).json({
            sucess:true,
            data:city,
            message:'successfully got all the city',
            error:{}
        })
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(500).json({
            sucess:false,
            err:error,
            message:"Not able to got all the city",
            error:{}
        })
    }
}
const addAllCity = async(req,res)=>{
    try {
        const city = await cityService.addAll(req.body)
        return res.status(200).json({
            sucess:true,
            data:city,
            message:'successfully got all the city',
            error:{}
        })
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(500).json({
            sucess:false,
            err:error,
            message:"Not able to got all the city",
            error:{}
        })
    }
}

module.exports ={
    create,
    destroy,
    update,
    getCity,
    getAllCity,
    addAllCity
}