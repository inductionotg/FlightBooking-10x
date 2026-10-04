# Flight search: measured index improvement

## Why this change

The audit and Redis load tests found full-table scans on cache misses. Redis reduced some reads, but the remaining queries still examined roughly 10,000 rows each. The representative query filters by departure airport, arrival airport and a price range. The new non-unique index is:

```sql
CREATE INDEX flights_route_price_idx
ON Flights (departureAirportId, arrivalAirportId, price);
```

The two equality filters come first, followed by the range filter. This permits a range scan within one route. Seat changes do not modify any indexed column, while flight inserts and route/price edits now maintain this extra index. MySQL remains the database; this is a query-access improvement, not an engine migration.

Only one index is added. Arrival-only, price-only and unfiltered searches are not necessarily helped by this index, and broad queries still return large responses. Their frequency has not been measured, so additional indexes and API pagination are separate decisions. Response ordering was never specified by this endpoint; clients must not rely on the physical table/index order.

## Actual query plan

On September 30, the same route/price query returned the same 100 complete flight records before and after the change:

| Measurement | Before | After |
| --- | ---: | ---: |
| Access path | Full table scan | Composite index range scan |
| Actual scan rows | 10,304 | 100 |
| Query completion time in EXPLAIN ANALYZE | 7.82 ms | 0.656 ms |

This single-query timing is diagnostic evidence, not an end-to-end capacity claim. Raw plans and result equality verification are in [search-index-plan-results.json](search-index-plan-results.json). Full traffic results are in [before-after-metrics.md](before-after-metrics.md).

The 200/s runs confirmed search SQL improved from 11.51 ms to approximately 1 ms on average, but aggregate HTTP failures increased from 34.10% to 71.25% and 70.62%. The local stack retains this index for investigation of the cache command failures, circuit bypasses and rejected reads; this is not a completed capacity improvement. The 20/s baseline still passes.

## Apply and roll back

The migration is `FlightandSearchService/src/migrations/20260930140000-add-flight-search-index.js`. Its `up` adds the index and its `down` removes only that index. The model declares the same index to keep model metadata consistent. Fresh setup applies it through the migration chain.

For the existing local databases created originally with model sync:

```powershell
node scripts/apply-search-index.cjs
```

This checks the exact local schema and port, applies only this migration, records it in `LocalSchemaChanges`, captures query plans, and verifies equal query results. A repeated run validates the existing index without duplicating it. It does not fabricate historical `SequelizeMeta` records. No app restart is required for MySQL to use a new index.

For a deployment with reconciled Sequelize migration history, use its normal migration process. MySQL DDL auto-commits and can wait for metadata locks; production execution needs its own timing and lock-impact assessment. The local measurement does not establish online-build safety for a large production table. To roll back, execute this migration's `down` through that deployment's migration process; remove only `flights_route_price_idx`, preserving flight and reservation data.

Validation uses `node scripts/verify-migrations.cjs` on disposable schemas, including index rollback/reapplication around an existing flight record. k6 uses unchanged Redis settings, request mix and thresholds, with fresh booking inventory. No cache timeout, concurrency cap, service count or database pool setting is changed with this index.

All 19 migration checks and all 13 Redis integration checks passed after applying the index. The latter include booking/cancellation invalidation and route/price changes. See [migration results](migration-check-results.json) and [cache results](redis-test-results.json).
