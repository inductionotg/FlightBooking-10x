# Transactional reservations: implemented changes

The original booking flow read availability, created a booking, then overwrote the flight's seat count using an earlier read. The baseline last-seat probe confirmed 20 bookings for one seat. The new flow confirms one booking and rejects the other 19.

## Files and responsibilities

| File | Change |
| --- | --- |
| `FlightandSearchService/src/services/reservation-service.js` | MySQL managed transaction, flight row lock, inventory deduction, unique reservation record, idempotent release |
| `FlightandSearchService/src/models/reservation.js` | Reservation identified by booking ID; Reserved, Released, or Rejected state |
| `FlightandSearchService/src/migrations/20260929130000-create-reservations.js` | Reservations table with unique primary booking ID and flight foreign key |
| `FlightandSearchService/src/controllers/reservation-controller.js` | Internal reservation/release endpoints protected by a shared service key |
| `FlightandSearchService/src/routes/v1/index.js` | Registers POST `/api/v1/reservations` and `/api/v1/reservations/release` |
| `FlightandSearchService/src/repository/flight-repository.js` | Rejects legacy absolute seat-count edits while active reservations exist, under the same flight lock |
| `Booking_Service/src/services/booking-service.js` | Request-key deduplication, pending workflow, confirmation, cancellation, durable retry selection |
| `Booking_Service/src/controller/booking-controller.js` | Existing create endpoint returns 200 booked, 202 pending, or 409 unavailable/cancelled; echoes Idempotency-Key |
| `Booking_Service/src/services/booking-recovery.js` | Polls pending work in batches of 50; first tick after 1 second, then 5 seconds after each batch completes |
| `Booking_Service/src/migrations/20260929131000-add-booking-recovery.js` | Unique hashed request key and recovery/cancellation columns and due-work index |
| `Booking_Service/src/models/booking.js` | Matching new fields; existing booking statuses retained |

Both service config modules accept `RESERVATION_SERVICE_KEY`. The booking startup starts recovery automatically. Routes also include POST `/api/v1/booking/:id/cancel`. No Redis or RabbitMQ was added.

## Transaction boundary

Flight Service uses `sequelize.transaction(async transaction => ...)`. It reads the flight with `lock: transaction.LOCK.UPDATE` (MySQL SELECT FOR UPDATE). The availability check, seat decrement, and reservation insert all occur while holding that lock, in one database transaction. Managed transactions commit on success and roll back when an operation throws. Network calls never run inside this transaction.

Concurrent requests for the same flight must wait for the lock. After the first request commits, the next sees the updated inventory. If the reservation insert fails, the seat decrement rolls back. An existing reservation with the same booking ID returns its saved result without another deduction. The price is captured in the reservation so retries do not change the total cost.

Booking and flight databases do not share a transaction. Booking persists InProcess before calling Flight Service, with a stable booking ID. After a successful reservation it changes InProcess to Booked using a conditional update requiring `cancelRequested=false`. Timeouts and server failures leave the booking pending with a future retry timestamp. A worker retries that same reservation, so losing the HTTP reply does not lose knowledge of the committed seat deduction.

Cancellation sets durable cancellation intent first and then releases seats in Flight Service. Release restores seats and marks the reservation Released in one transaction. Repeated release cannot add seats twice. A release that arrives before reserve creates a Released record; this prevents a delayed reserve from taking seats afterward. A delayed booking confirmation cannot overwrite cancellation because of the conditional booking update.

## API behavior

Create or retry the same booking attempt:

```http
POST /api/v1/booking
x-access-token: <caller-token>
Content-Type: application/json
Idempotency-Key: booking-attempt-unique-uuid

{"flightId":123,"noOfSeats":2}
```

- 200: Booked.
- 202: InProcess; keep the same key for polling/retry. Recovery also proceeds without client retries.
- 409: unavailable/cancelled, or a key reused with different flight/seat inputs.
- 400: invalid IDs, seat count, or request-key format.
- 503: booking infrastructure failure; retry using the same client-supplied key.

Keys are scoped to the user ID and stored as a SHA-256 digest with a unique database index. Clients should generate and persist their key **before** the first call. For backward compatibility, omitting the key still works and the server returns a generated key in the `Idempotency-Key` header; if that first response is lost, a client without a preselected key cannot safely deduplicate the retry. Key reuse with changed flight/seat data returns 409.

Cancel using the original key and user ID:

```http
POST /api/v1/booking/789/cancel
x-access-token: <owner-token>
Content-Type: application/json
Idempotency-Key: booking-attempt-unique-uuid

{}
```

Returns 200 when release is complete, or 202 while it is being retried. Wrong keys or a different authenticated owner return 404. Booking and cancellation now require a verified token and ignore body `userId`. Cancellation additionally requires the original key. See [authorization](authorization.md).

Flight reservation endpoints require `x-reservation-key` matching `RESERVATION_SERVICE_KEY` in both services. A missing configured key disables those endpoints (503); a missing/wrong request key returns 401. Generated local secrets stay in ignored .env files.

## Migrations and local application

Fresh setup runs the full migration histories and configures one generated service key for both services. For the existing model-sync baseline, `node scripts/apply-reservation-migrations.js` applied only these two additive migrations and recorded them in `LocalSchemaChanges`, preserving existing booking/flight rows. It does not fabricate old SequelizeMeta history. The running Flight and Booking processes were restarted.

Existing bookings with a null requestKey are deliberately excluded from automatic recovery: old confirmed bookings have no reservation records, and automatically reserving them again would corrupt inventory. Historical overselling from the earlier audit remains test evidence and is not silently repaired. Production adoption of legacy records needs a separate reconciliation plan. A failed MySQL DDL migration can be partially applied; inspect it before rerunning. Down migrations destroy the new workflow metadata and should only be exercised on disposable test databases after quiescing services.

## Verification

- `node scripts/verify-migrations.js`: 18 checks passed on four fresh disposable schemas, including full rollback/reapplication; test schemas removed.
- `node scripts/verify-reservations.js`: 13 integration checks passed: concurrency, duplicate keys, conflicting payloads, protected inventory edits, price stability, repeated cancellation, transactional rollback, lost reply, process exit after remote commit, automatic retry after service failure, retry after failed release, cancellation-before-reserve, and validation/internal endpoint protection.
- The crash check starts a separate process running the actual BookingService, commits a real Flight Service reservation, and exits with code 86 before booking confirmation. The running booking recovery worker finishes that persisted booking. Other outage tests inject client failures; they are not claims that the live Flight Service was killed.
- `node scripts/smoke-local.js`: all 14 existing functional checks passed, including gateway routing and notifications ticket creation/deletion.
- `node load-tests/run.js contention after-transactions-contention 1s`: exact outcome **1 confirmed, 19 insufficient-seat responses, inventory drift 0**, exit code 0. The scenario sends 20 concurrent iterations; it is not a one-second arrival-rate test. Its assertions were strengthened to require exactly one confirmation, 19 explicit rejections, and no unexpected response.

Results: `reservation-test-results.json`, `migration-check-results.json`, `step-1-smoke-results.json`, and `../load-tests/results/after-transactions-contention/summary.json`. Expected 409 responses in a last-seat test are not infrastructure errors even though k6's default HTTP-failure metric counts them. No new 20/200 requests-per-second performance comparison has been run for this change yet; correctness results do not prove 10x capacity.

## Operational limits

Recovery uses durable database state and a bounded batch, with fixed 5-second retry scheduling and a 3-second HTTP timeout. It is not a distributed ACID transaction. Reservations remain pending while dependencies are unavailable; there is no automatic reservation expiry or payment integration in this change. Keep Released/Rejected records and request keys while old requests can be retried. Future multi-instance deployments can execute duplicate recovery attempts safely, but leases/backoff and operational alerting may be needed for efficiency under prolonged failures. No maximum recovery delay is promised under backlog or an ongoing outage.
