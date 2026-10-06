const UserServices = require('../services/user-services')

const userService = new UserServices()



const create = async (req,res)=>{
    try {
        const response = await userService.create({
            email:req.body.email,
            password:req.body.password
        })
        return res.status(200).json({
            message:'User created successfully',
            success:true,
            data:{response:{id:response.id, email:response.email}},
            err:{}
        })
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(error.statusCode).json({
            message:error.message,
            success:false,
            data:{},
            err:error.explanation
        })
    }
}

const destroy = async (req,res) =>{
    try {
        const principal = await userService.getPrincipal(req.headers['x-access-token']);
        if (principal.id !== Number(req.params.id) && !principal.roles.includes('ADMIN'))
            return res.status(403).json({success:false, message:'Cannot delete another account', data:{}});
        const response = await userService.destroy(req.params.id)
        return res.status(201).json({
            message:'User deleted successfully',
            success:true,
            data:{response},
            err:{}
        })
        
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(error.statusCode || 503).json({
            message:error.statusCode ? error.message : 'User not deleted successfully',
            success:false,
            data:{},
            err:{}
        })
    }
}

const getUser = async (req,res) =>{
    try {
        const principal = await userService.getPrincipal(req.headers['x-access-token']);
        if (principal.id !== Number(req.params.id) && !principal.roles.includes('ADMIN'))
            return res.status(403).json({success:false, message:'Cannot read another account', data:{}});
        const response = await userService.getUserById(req.params.id)
        return res.status(201).json({
            message:'User fetched successfully',
            success:true,
            data:{response},
            err:{}
        })
        
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(error.statusCode || 503).json({
            message:error.statusCode ? error.message : 'User lookup unavailable',
            success:false,
            data:{},
            err:error.explanation
        })
    }
}

const signIn = async (req,res) =>{
    try {
        //const response = await userService.signIn(req.body)-->THIS WILL ALSO WORK
        const response = await userService.signIn(
            req.body.email,
            req.body.password
        )
        return res.status(201).json({
            message:'User signed In successfully',
            success:true,
            data:response,
            err:{}

        })
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(error.statusCode || 401).json({
            message:error.statusCode ? error.message : 'Invalid email or password',
            success:false,
            data:{},
            err:error.explanation
        })
    }
}

const isAuthenticated = async (req,res)=>{
    try {
        const token = req.headers['x-access-token']
        const response = await userService.isAuthenticated(token)
        return res.status(201).json({
            message:'Token verified:User is Authenticated and Token is valid',
            success:true,
            data:{response},
            err:{}
        })
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(error.statusCode || 503).json({
            message:error.statusCode ? error.message : 'Authentication unavailable',
            success:false,
            data:{},
            err:{}
        })
    }
}

const isAdmin = async (req,res)=>{
    try {
        const principal = await userService.getPrincipal(req.headers['x-access-token'])
        const response = principal.roles.includes('ADMIN')
        return res.status(200).json({
            message:'Successfullly fetched whether user is Admin or not',
            success:true,
            data:response,
            err:{}
        })
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(error.statusCode || 503).json({
            message:error.statusCode ? error.message : 'Authentication unavailable',
            success:false,
            data:{},
            err:{}
        })
    }
}

const me = async (req, res) => {
    try {
        const principal = await userService.getPrincipal(req.headers['x-access-token']);
        return res.status(200).json({success:true, data:principal});
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(error.statusCode || 503).json({success:false,
            message:error.statusCode ? error.message : 'Authentication unavailable', data:{}});
    }
};



module.exports = {
    create,
    destroy,
    getUser,
    signIn,
    isAuthenticated,
    isAdmin,
    me
}
