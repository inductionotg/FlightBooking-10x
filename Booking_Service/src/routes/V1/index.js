const express = require('express')
const {BookingController} = require('../../controller/index')
const router = express.Router()
const requireUser = require('../../middlewares/require-user')

router.post('/booking',requireUser,BookingController.createBooking)
router.get('/booking',requireUser,BookingController.listBookings)
router.get('/booking/:id',requireUser,BookingController.getBooking)
router.post('/booking/:id/cancel',requireUser,BookingController.cancelBooking)


module.exports = router;
