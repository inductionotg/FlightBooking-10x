const express = require('express')
const {BookingController} = require('../../controller/index')
const router = express.Router()
const requireUser = require('../../middlewares/require-user')

router.post('/booking',requireUser,BookingController.createBooking)
router.post('/booking/:id/cancel',requireUser,BookingController.cancelBooking)


module.exports = router;
