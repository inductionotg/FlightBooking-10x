const sender = require('../config/email-config')
const  htmlToSend = require('../utils/template')
const  TicketRepository  = require('../repository/ticket-repository')
/*
const sendBasicEmail = async (mailFrom, mailTo, mailSubject, mailBody)=>{
    try{
        const response =await sender.sendMail({
            from:mailFrom,
            to:mailTo,
            subject:mailSubject,
            text:mailBody
        })
    }
    catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
    }
}
*/
class TicketService {

    constructor(){
        this.ticketRepository = new TicketRepository()
    }

   async sendBasicEmail (mailFrom, mailTo, mailSubject, mailBody){
        try {
            const response =await sender.sendMail({
                from:mailFrom,
                to:mailTo,
                subject:mailSubject,
                text:mailBody,
                html:htmlToSend,
                /*
                attachments:[
                    {
                        filename:'SMVT.PDF',
                        path:'./SMVT.pdf'
                    }
                ]
                */
            })
            
        } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        }
    }
    async createTicket(data){
        try {
            const response = await this.ticketRepository.create(data)
            return response
        } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        }
    }

    async fetchPendingEmails(){
        try {
            const response = await this.ticketRepository.get({status:'PENDING'})
            return response
        } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        }
    }
    async destroy(ticketId){
        try {
            const response = await this.ticketRepository.destroy(ticketId)
            return response
        } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        }
    }

    async updateTicket(ticketId,data){
        try {
            const response = await this.ticketRepository.update(ticketId,data)
            return response
        } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
        }
    }

}
module.exports = TicketService