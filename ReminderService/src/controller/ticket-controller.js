const TicketService = require('../services/email-service')
const ticketService = new TicketService()
const createTicket =async(req,res)=>{
    try {
        const response =await ticketService.createTicket(req.body)
        return res.status(201).json({
            success:true,
            messgae:'Ticket got created successfully',
            data:response,
            error:{}
        })
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(500).json({
            success:false,
            messgae:'Ticket Not created successfully',
            data:{},
            error:error
        })
    }
}

const deleteTicket =async(req,res)=>{
    try {
        const response =await ticketService.destroy(req.params.id)
        return res.status(200).json({
            success:true,
            messgae:'Ticket got deleted successfully',
            data:response,
            error:{}
        })
    } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        return res.status(500).json({
            success:false,
            messgae:'Ticket Not deleted successfully',
            data:{},
            error:error
        })
    }
}

module.exports = {
    createTicket,
    deleteTicket
}