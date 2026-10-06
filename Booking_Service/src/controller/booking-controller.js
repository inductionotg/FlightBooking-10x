const crypto = require('crypto');
const telemetry = require('../observability');
const {BookingService} = require('../services');
const bookingService = new BookingService();

function output(booking) {
    const {requestKey, traceParent, notificationEmail, ...data} = booking.toJSON();
    return data;
}
function historyOutput(booking) {
    const {id, flightId, userId, status, noOfSeats, totalCost, createdAt, updatedAt,
        cancelRequested, reservationReleased, failureCode} = booking;
    return {id, flightId, userId, status, noOfSeats, totalCost, createdAt, updatedAt,
        cancelRequested, reservationReleased, failureCode, canCancel:Boolean(booking.requestKey) && status === 'Booked'};
}
function readFailure(res,error) {
    telemetry.log('booking.read_failed', {errorType:error.name || 'Error'}, 'error');
    return res.status(error.statusCode || 503).json({success:false, code:error.code || 'HISTORY_UNAVAILABLE',
        message:error.statusCode ? error.message : 'Booking history is temporarily unavailable', data:{}});
}
const listBookings = async (req,res) => {
    res.set('Cache-Control','private, no-store');
    try {
        const page = await bookingService.listBookings(req.authUser.id,req.query);
        return res.json({success:true,data:{items:page.items.map(historyOutput),nextCursor:page.nextCursor}});
    } catch(error) { return readFailure(res,error); }
};
const getBooking = async (req,res) => {
    res.set('Cache-Control','private, no-store');
    try { return res.json({success:true,data:historyOutput(await bookingService.getOwnedBooking(Number(req.params.id),req.authUser.id))}); }
    catch(error) { return readFailure(res,error); }
};
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
        const booking = await bookingService.createBooking({...req.body, userId:req.authUser.id}, key);
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
        const key = req.get('Idempotency-Key');
        const booking = key === undefined
            ? await bookingService.cancelOwnedBooking(Number(req.params.id), req.authUser.id)
            : await bookingService.cancelBooking(Number(req.params.id), req.authUser.id, key);
        telemetry.log('booking.cancellation', {bookingId:booking.id,outcome:booking.reservationReleased?'released':'pending'});
        return res.status(booking.reservationReleased ? 200 : 202).json({success: true,
            message: booking.reservationReleased ? 'Booking cancelled and seats released' : 'Cancellation pending seat release', data: output(booking)});
    } catch (error) { return failure(res, error, false); }
};
module.exports = {createBooking, cancelBooking, listBookings, getBooking};
