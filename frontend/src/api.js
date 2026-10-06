const roots = {
  auth: '/backend/auth/api/v1',
  flights: '/backend/flights/api/v1',
  booking: '/backend/booking/api/v1'
};

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(service, path, { method = 'GET', body, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(`${roots[service]}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new ApiError('Cannot reach the service. Check that the local backend is running.', 0, 'NETWORK');
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new ApiError(payload?.message || `Request failed (${response.status})`, response.status, payload?.code);
  }
  return { data: payload?.data, status: response.status, headers: response.headers };
}

export const api = {
  catalog: () => request('flights', '/catalog'),
  searchFlights: filters => {
    const query = new URLSearchParams(filters);
    return request('flights', `/flights?${query}`);
  },
  flight: id => request('flights', `/flights/${encodeURIComponent(id)}`),
  signIn: (email, password) => request('auth', '/signIn', { method: 'POST', body: { email, password } }),
  signUp: (email, password) => request('auth', '/signup', { method: 'POST', body: { email, password } }),
  verifyToken: token => request('auth', '/isAuthenticated', { headers: { 'x-access-token': token } }),
  me: token => request('auth', '/me', { headers: { 'x-access-token': token } }),
  book: (body, key, token) => request('booking', '/booking', { method: 'POST', body, headers: { 'Idempotency-Key': key, 'x-access-token': token } }),
  cancel: (id, key, token) => request('booking', `/booking/${encodeURIComponent(id)}/cancel`, {
    method: 'POST', headers: { 'Idempotency-Key': key, 'x-access-token': token }
  }),
  createCity: (name, token) => request('flights', '/city', { method: 'POST', body: { name }, headers: { 'x-access-token': token } }),
  createAirport: (body, token) => request('flights', '/airports', { method: 'POST', body, headers: { 'x-access-token': token } }),
  createAirplane: (body, token) => request('flights', '/airplanes', { method: 'POST', body, headers: { 'x-access-token': token } }),
  createFlight: (body, token) => request('flights', '/flights', { method: 'POST', body, headers: { 'x-access-token': token } }),
  updateFlight: (id, body, token) => request('flights', `/flights/${encodeURIComponent(id)}`, { method: 'POST', body, headers: { 'x-access-token': token } })
};
