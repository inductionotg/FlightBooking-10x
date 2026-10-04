const crypto = require('crypto');
const telemetry = require('../observability');
const {BookingService} = require('../services');
const bookingService = new BookingService();

function output(booking) {
    const {requestKey, traceParent, notificationEmail, ...data} = booking.toJSON();
    return data;
}
function failure(res, error, creation = true) {
    if (creation) telemetry.add('booking_responses_total', {outcome:'error'});
    telemetry.log('booking.failed', {errorType:error.name || 'Error'}, 'error');
    return res.status(error.statusCode || 503).json({success: false, code: error.code || 'BOOKING_RETRY',
        message: error.statusCode ? error.message : 'Booking could not be completed; retry with the same Idempotency-Key', data: {}});
}
const createBooking = async (req, res) => {
    const key = req.get('Idempotency-Key') || crypto.randomUUID();
    if (/^[\x21-\x7e]{1,128}$/.test(key)) res.set('Idempotency-Key', key);
    try {
        const booking = await bookingService.createBooking(req.body, key);
        telemetry.bookingOutcome(booking);
        const pending = booking.status === 'InProcess';
        const cancelled = booking.status === 'Cancelled';
        return res.status(cancelled ? 409 : pending ? 202 : 200).json({
            success: !cancelled, code: booking.failureCode || (cancelled ? 'BOOKING_CANCELLED' : undefined),
            message: pending ? 'Booking is pending; retry with the same Idempotency-Key' : cancelled ? 'Booking cancelled' : 'Successfully completed booking',
            data: output(booking), err: {}
        });
    } catch (error) { return failure(res, error); }
};
const cancelBooking = async (req, res) => {
    try {
        const booking = await bookingService.cancelBooking(Number(req.params.id), Number(req.body.userId), req.get('Idempotency-Key'));
        telemetry.log('booking.cancellation', {bookingId:booking.id,outcome:booking.reservationReleased?'released':'pending'});
        return res.status(booking.reservationReleased ? 200 : 202).json({success: true,
            message: booking.reservationReleased ? 'Booking cancelled and seats released' : 'Cancellation pending seat release', data: output(booking)});
    } catch (error) { return failure(res, error, false); }
};
module.exports = {createBooking, cancelBooking};
