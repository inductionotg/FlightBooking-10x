const express = require('express')
const TicketController = require('../../controller/ticket-controller')
const router = express.Router()

router.post('/createticket',TicketController.createTicket)
router.delete('/deleteticket/:id',TicketController.deleteTicket)
module.exports = router