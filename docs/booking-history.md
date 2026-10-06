# Durable booking history

My journeys now reads the signed-in account's bookings from MySQL. Closing the browser does not remove those bookings. Sign in again and open **My journeys** to retrieve them, refresh their status, or cancel a reservation.

## API

All routes below require a valid `x-access-token` or Bearer token. The server derives the owner ID from the token; a `userId` query or body cannot select another account. Even admins see only their own booking history through these customer endpoints.

| Method and route | Behavior |
| --- | --- |
| `GET /api/v1/booking?limit=20` | Newest bookings first; `{items, nextCursor}` in `data` |
| `GET /api/v1/booking?limit=20&beforeId=123` | Next page containing IDs below the previous page's cursor |
| `GET /api/v1/booking/{id}` | Current status of a booking owned by the caller; another owner's ID returns 404 |
| `POST /api/v1/booking/{id}/cancel` | Cancel an owned reservation without needing the original browser key |

Page size defaults to 20 and is limited to 1–50. Invalid cursors or sizes return 400. ID-based pagination keeps newly inserted bookings from shifting older pages. A refresh returns to the newest page. History responses use `Cache-Control: private, no-store`. Responses omit request-key hashes, notification email, internal trace context, and recovery scheduling fields.

Cancellation remains idempotent: repeated calls do not release seats twice. Clients that send an `Idempotency-Key` still get the existing key validation. Clients without a key are authorized using the owner token and booking ID. Pre-reservation legacy records without a stored request key require manual cancellation; history exposes `canCancel: false` for them.

## UI and failure behavior

My journeys shows loading, empty, and error states, a Refresh button, and Load older bookings. It reads persisted prices, seat counts, and status from Booking. A record without locally retained flight details shows its flight ID and booking date; it does not infer a departure date from the booking date. Pending booking/cancellation status can be checked with the owned GET endpoint; background recovery continues to resolve it.

Local session storage is still used for an ambiguous request that has no returned booking ID, so it can retry the original creation key safely. It is not the source of account history. A request that never reached the server cannot appear in database history. Once its booking ID is known, status checks use GET and do not recreate the booking.

## Schema and rollout

Fresh setups apply migration `20261006010000-add-booking-history-index.js`, which adds `(userId, id)` to support filtering by owner and cursor ordering. Rollback removes only that index. Existing records and booking transaction behavior are preserved.

For the original local schema created using model sync:

```powershell
node scripts/apply-history-index.js
```

The helper checks the dedicated local database, applies only the missing index, and records the query plans in `docs/history-index-plan.json`. It does not mark unrelated migrations as applied. Restart Booking after updating its code.

## Verification

```powershell
node scripts/verify-booking-history.js
node scripts/verify-reservations.js
```

The history test creates isolated local accounts and a test flight. It signs in again without reusing browser state, verifies pagination and private response fields, rejects cross-account reads/cancellation, and checks that repeated owner cancellation restores seats exactly once. These are functional checks, not a new 200 requests/second capacity result.

The [history checks](booking-history-results.json) passed on 2026-10-06, as did all 13 existing reservation checks. The React build and all 20 [migration checks](migration-check-results.json) passed, including history-index rollback and full schema reapplication. The [recorded query plan](history-index-plan.json) for the most common local owner still chose a backward primary-index scan after the new index became available; no latency improvement is claimed from that plan.
