const crypto = require('crypto');
const service = require('../services/reservation-service');
const {RESERVATION_SERVICE_KEY} = require('../config/serverConfig');

function internalOnly(req, res, next) {
  if (!RESERVATION_SERVICE_KEY) return res.status(503).json({success: false, code: 'RESERVATION_NOT_CONFIGURED'});
  const expected = Buffer.from(RESERVATION_SERVICE_KEY);
  const provided = Buffer.from(req.get('x-reservation-key') || '');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).json({success: false, code: 'UNAUTHORIZED_RESERVATION'});
  }
  next();
}
const handle = action => async (req, res) => {
  try {
    const data = await service[action]({bookingId: req.body.bookingId, flightId: req.body.flightId, noOfSeats: req.body.noOfSeats});
    if (action === 'reserve' && data.status !== 'Reserved') {
      return res.status(409).json({success: false, code: data.status === 'Released' ? 'RESERVATION_RELEASED' : 'INSUFFICIENT_SEATS'});
    }
    return res.status(200).json({success: true, data});
  } catch (error) {
        require('../observability').log('operation.failed', {errorType:error.name || 'Error'}, 'error');
    // A duplicate booking ID on a different flight rolls back its entire transaction.
    const conflict = error.name === 'SequelizeUniqueConstraintError';
    return res.status(error.statusCode || (conflict ? 409 : 503)).json({
      success: false, code: error.code || (conflict ? 'RESERVATION_CONFLICT' : 'RESERVATION_RETRY'),
      message: error.statusCode ? error.message : 'Reservation could not be completed'
    });
  }
};
module.exports = {internalOnly, reserve: handle('reserve'), release: handle('release')};
