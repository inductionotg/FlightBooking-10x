const BookingService = require('./booking-service');
function startRecovery() {
    const service = new BookingService();
    let stopped = false;
    let timer;
    const tick = async () => {
        try { await service.recoverPending(); }
        catch (error) { require('../observability').log('booking.recovery_unavailable', {errorType:error.name}, 'error'); }
        if (!stopped) { timer = setTimeout(tick, 5000); timer.unref(); }
    };
    timer = setTimeout(tick, 1000);
    timer.unref();
    return () => { stopped = true; clearTimeout(timer); };
}
module.exports = {startRecovery};
