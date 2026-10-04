const express = require('express')
const router = express.Router()
const { FlightValidateMiddlewares } = require('../../middlewares/index');
const { create,destroy,update,getCity, getAllCity,addAllCity } = require('../../controllers/city-controllers')
const AirportController = require('../../controllers/airport-controllers')
const FlightController  = require('../../controllers/flight-controllers')
const ReservationController = require('../../controllers/reservation-controller')
router.post('/reservations', ReservationController.internalOnly, ReservationController.reserve)
router.post('/reservations/release', ReservationController.internalOnly, ReservationController.release)
router.get('/internal/cache-metrics', ReservationController.internalOnly, (req, res) => {
    res.json({success: true, data: require('../../utils/flight-cache').cache.snapshot()})
})
router.post('/city',create)
router.post('/cityAll',addAllCity)
router.delete('/city/:id',destroy)
router.get('/city/:id',getCity)
router.get('/city',getAllCity)
router.patch('/city/:id',update)

router.post('/airports',AirportController.create)


router.post('/flights',
    FlightValidateMiddlewares.createValidateFlight,
    FlightController.create)
router.get('/flights/:id',FlightController.getFlight)
router.get('/flights',FlightController.getAllFlight)
router.post('/flights/:id',FlightController.updateFlight)

module.exports = router;
