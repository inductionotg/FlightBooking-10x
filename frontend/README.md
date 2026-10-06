# Aeris web UI

This local React + JavaScript + Tailwind CSS interface includes customer flight search, flight details, sign-up/sign-in, booking, retry, cancellation, and an operator console for creating cities, airports, aircraft, and flights or updating a flight's fare and gate.

## Run

First start the backend and Docker services using the [project guide](../docs/project-guide.md#first-time-local-setup). Then, in a separate PowerShell terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). `npm ci` is needed only on first install or after dependency changes. For a build check, run `npm run build`.

To populate realistic-looking destinations in a fresh local database, run `node scripts/seed-demo-catalog.js` from the repository root after starting the flight service. The [demo-data guide](../docs/demo-data.md) lists the airport and airline sources and explains which flight details are fictional. This seed has already been applied to the current local database.

Vite proxies `/backend/auth` to auth on port 3001, `/backend/flights` to flights on port 3002, and `/backend/booking` to booking on port 3003. The five backend services run on the host; Docker Compose runs MySQL, Redis, RabbitMQ and the optional monitoring/messaging containers. The UI calls services directly through this development proxy because the existing gateway forwards flight routes only and has a five-request/two-minute limit. Keep this development server local.

## Use

1. **Explore:** choose departure and arrival airports, optionally date or price, then search. The date and displayed times use your browser's local time zone. Open a flight to see availability and fare.
2. **Book:** create an account or sign in, select seats and optional email, then confirm. The UI retains the booking's `Idempotency-Key`; if a request times out, retry it from **My journeys**. Confirmation email is captured by local Mailpit when configured. No payment is processed.
3. **My journeys:** shows receipts created in the current browser session and offers retry or cancellation. The backend has no booking-history API yet, so this is not durable account history.
4. **Admin tools:** sign in with the generated local admin account, create catalog entries for a route, publish a flight, or find a flight by ID to change its fare or gate. The new `GET /api/v1/catalog` and `POST /api/v1/airplanes` flight-service routes support this screen.

**Authorization:** Flight write APIs verify the token and require the ADMIN role. Booking and cancellation derive the user ID from the token; a browser-supplied `userId` is ignored. Run `node scripts/create-local-admin.js` from the repository root once; sign in with the credentials saved in ignored `.local/admin-credentials.json`. New sign-ups have no admin role. See [backend authorization](../docs/authorization.md).
