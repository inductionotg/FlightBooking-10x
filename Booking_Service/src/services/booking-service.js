const crypto = require('crypto');
const axios = require('axios');
const telemetry = require('../observability');
const {Op} = require('sequelize');
const {Booking,BookingOutbox,sequelize} = require('../models');
const {FLIGHT_SERVICE_PATH, RESERVATION_SERVICE_KEY} = require('../config/server-config');

function problem(statusCode, code, message) {
    return Object.assign(new Error(message), {statusCode, code});
}
const later = () => new Date(Date.now() + 5000);
function requestKey(userId, key) {
    return crypto.createHash('sha256').update(`${userId}\0${key}`).digest('hex');
}
function validateKey(key) {
    if (typeof key !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(key)) {
        throw problem(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must contain 1–128 printable non-space ASCII characters');
    }
}
class BookingService {
    constructor({flightClient = axios} = {}) { this.flightClient = flightClient; }

    async createBooking(data, key = crypto.randomUUID()) {
        validateKey(key);
        const payload = {flightId: Number(data.flightId), userId: Number(data.userId), noOfSeats: Number(data.noOfSeats ?? 1)};
        for (const [field, value] of Object.entries(payload)) {
            if (!Number.isSafeInteger(value) || value <= 0 || value > 2147483647) {
                throw problem(400, 'INVALID_BOOKING', `${field} must be a positive integer`);
            }
        }
        const hash = requestKey(payload.userId, key);
        const notificationEmail = data.notificationEmail ?? null;
        if (notificationEmail !== null && (typeof notificationEmail !== 'string' || notificationEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail))) {
            throw problem(400,'INVALID_NOTIFICATION_EMAIL','A valid notificationEmail is required');
        }
        let booking = await Booking.findOne({where: {requestKey: hash}});
        if (!booking) {
            try {
                booking = await Booking.create({...payload, notificationEmail, traceParent:telemetry.headers().traceparent || null, requestKey: hash, nextAttemptAt: later()});
            } catch (error) {
                if (error.name !== 'SequelizeUniqueConstraintError') throw error;
                booking = await Booking.findOne({where: {requestKey: hash}});
                if (!booking) throw error;
            }
        }
        if (Object.entries(payload).some(([field, value]) => booking[field] !== value) || booking.notificationEmail !== notificationEmail) {
            throw problem(409, 'IDEMPOTENCY_CONFLICT', 'This key was already used for a different booking');
        }
        return this.reconcile(booking.id);
    }

    async callFlight(action, booking) {
        if (!RESERVATION_SERVICE_KEY) throw new Error('Reservation service key is missing');
        const response = await telemetry.span('flights', action, traceHeaders => this.flightClient.post(`${FLIGHT_SERVICE_PATH}/api/v1/reservations${action === 'release' ? '/release' : ''}`, {
            bookingId: booking.id, flightId: booking.flightId, noOfSeats: booking.noOfSeats
        }, {headers: {...traceHeaders, 'x-reservation-key': RESERVATION_SERVICE_KEY}, timeout: 3000}));
        const receipt = response.data && response.data.data;
        if (!receipt || receipt.bookingId !== booking.id || receipt.flightId !== booking.flightId ||
            receipt.noOfSeats !== booking.noOfSeats || receipt.status !== (action === 'release' ? 'Released' : 'Reserved') ||
            !Number.isSafeInteger(receipt.totalCost) || receipt.totalCost < 0) {
            throw new Error('Invalid reservation receipt');
        }
        return receipt;
    }

    async reconcile(id) {
        let booking = await Booking.findByPk(id);
        if (!booking) throw problem(404, 'BOOKING_NOT_FOUND', 'Booking not found');
        // Older bookings have no reservation records; never invent reservations for them.
        if (!booking.requestKey) return booking;
        if (booking.cancelRequested) {
            if (booking.reservationReleased) return booking;
            try {
                await this.callFlight('release', booking);
                await Booking.update({status: 'Cancelled', reservationReleased: true, nextAttemptAt: null}, {where: {id, cancelRequested: true}});
            } catch (error) {
                const absent = error.response?.status === 404 && error.response?.data?.code === 'FLIGHT_NOT_FOUND';
                await Booking.update(absent ? {reservationReleased: true, nextAttemptAt: null} : {nextAttemptAt: later()}, {
                    where: {id, cancelRequested: true, reservationReleased: false}
                });
            }
            return Booking.findByPk(id);
        }
        if (booking.status !== 'InProcess') return booking;
        try {
            const reservation = await this.callFlight('reserve', booking);
            // Never overwrite a cancellation that raced with this HTTP request.
            await sequelize.transaction(async transaction=>{
                const current=await Booking.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});
                if(current.status!=='InProcess'||current.cancelRequested)return;
                await current.update({status:'Booked',totalCost:reservation.totalCost,nextAttemptAt:null},{transaction});
                const eventId=`booking.confirmed:${id}`;
                await BookingOutbox.create({eventId,bookingId:id,traceParent:current.traceParent,payload:{
                    eventId,type:'booking.confirmed.v1',bookingId:id,flightId:current.flightId,userId:current.userId,
                    noOfSeats:current.noOfSeats,totalCost:reservation.totalCost,notificationEmail:current.notificationEmail
                }},{transaction});
            });
        } catch (error) {
            const code = error.response?.data?.code;
            const terminal = [404, 409].includes(error.response?.status) &&
                ['INSUFFICIENT_SEATS', 'FLIGHT_NOT_FOUND', 'RESERVATION_RELEASED', 'INVALID_FLIGHT_PRICE'].includes(code);
            await Booking.update(terminal ? {
                status: 'Cancelled', failureCode: code, reservationReleased: true, nextAttemptAt: null
            } : {nextAttemptAt: later()}, {where: {id, status: 'InProcess', cancelRequested: false}});
            // Timeouts/5xx are ambiguous: leave InProcess and retry the SAME reservation.
        }
        booking = await Booking.findByPk(id);
        return booking.cancelRequested && !booking.reservationReleased ? this.reconcile(id) : booking;
    }

    async cancelBooking(id, userId, key) {
        validateKey(key);
        if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(userId) || userId <= 0) {
            throw problem(400, 'INVALID_BOOKING', 'Valid booking and user IDs are required');
        }
        const booking = await Booking.findOne({where: {id, userId, requestKey: requestKey(userId, key)}});
        if (!booking) throw problem(404, 'BOOKING_NOT_FOUND', 'Booking not found for this request key');
        await Booking.update({status: 'Cancelled', cancelRequested: true, reservationReleased: false, nextAttemptAt: later()}, {
            where: {id, cancelRequested: false}
        });
        return this.reconcile(id);
    }

    async recoverPending() {
        const bookings = await Booking.findAll({where: {
            requestKey: {[Op.ne]: null}, nextAttemptAt: {[Op.lte]: new Date()},
            [Op.or]: [{status: 'InProcess'}, {cancelRequested: true, reservationReleased: false}]
        }, order: [['nextAttemptAt', 'ASC'], ['id', 'ASC']], limit: 50});
        for (const booking of bookings) {
            try {
                await telemetry.job('booking.recover', async()=>{
                    const result = await this.reconcile(booking.id);
                    telemetry.log('booking.recovered', {bookingId:booking.id,outcome:result.status});
                });
            }
            catch (error) { telemetry.log('booking.recovery_failed', {bookingId:booking.id,errorType:error.name}, 'error'); }
        }
        return bookings.length;
    }
}
module.exports = BookingService;
