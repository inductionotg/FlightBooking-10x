const telemetry = require('../observability');
const authBase = (process.env.AUTH_SERVICE_URL || 'http://[::1]:3001').replace(/\/$/, '');

module.exports = async function requireAdmin(req, res, next) {
    const token = req.get('x-access-token') || req.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({success:false, message:'Authentication required'});
    try {
        const principal = await telemetry.span('auth', 'authenticate', async traceHeaders => {
            const response = await fetch(`${authBase}/api/v1/me`, {
                headers: {'x-access-token':token, ...traceHeaders},
                signal:AbortSignal.timeout(2000)
            });
            if (!response.ok) throw Object.assign(new Error('Authentication failed'), {statusCode:response.status === 401 ? 401 : 503});
            const identity = (await response.json()).data;
            if (!Number.isSafeInteger(identity?.id) || identity.id <= 0 || !Array.isArray(identity.roles))
                throw new Error('Invalid auth response');
            return identity;
        });
        if (!principal.roles.includes('ADMIN')) return res.status(403).json({success:false, message:'Admin role required'});
        req.authUser = principal;
        next();
    } catch (error) {
        const status = error.statusCode === 401 ? 401 : 503;
        return res.status(status).json({success:false, message:status === 401 ? 'Invalid or expired token' : 'Authentication unavailable'});
    }
};
