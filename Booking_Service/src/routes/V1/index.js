const express = require('express')
const {BookingController} = require('../../controller/index')
const router = express.Router()

router.post('/booking',BookingController.createBooking)
router.post('/booking/:id/cancel',BookingController.cancelBooking)


module.exports = router;
