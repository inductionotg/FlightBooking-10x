# Before/after comparison

Transactional inventory reservations and Docker Redis caching are implemented and tested. The original baseline below is preserved; measured results after the changes follow it. Redis improves the overloaded read path, but the 200 requests/s run still fails reliability targets. See [the audit](bottleneck-audit.md) for baseline conditions and raw evidence.

| Metric | Before at 20 requests/s (two runs) | Before at 200 requests/s (two runs) |
| --- | --- | --- |
| HTTP failure rate among issued requests | 0% / 0% | 50.19% / 38.30% |
| Overall p95 latency | 39.33 / 232.46 ms | 10,002.15 / 10,000.77 ms |
| Successful HTTP responses/s including drain | 20.03 / 20.04 | 49.67 / 58.83 |
| Dropped scheduled requests | 0 / 0 | 5,022 / 5,328 |
| Settled confirmed seats not deducted | 0 / 0 | 462 / 459 |

Separate correctness probe: 20 concurrent bookings for one available seat produced 20 confirmed bookings. Separate gateway probe: 196 of 201 flight requests were rate-limited. These are not part of the backend workload's error percentages.

Repeat the same workload, dataset distribution, versions, host, duration, timeouts, and VU settings after each justified change, using fresh booking inventory. Include recovery/settling before reconciliation. Document any changes to test conditions rather than claiming an equivalent comparison.

## Transaction correctness comparison

| Last-seat scenario (20 concurrent attempts, 1 available seat) | Before | After transactions |
| --- | ---: | ---: |
| Confirmed bookings | 20 | 1 |
| Explicit insufficient-seat responses | 0 | 19 |
| Confirmed seats missing from inventory deduction | 19 | 0 |

Evidence: [before](../load-tests/results/before-contention/summary.json), [after](../load-tests/results/after-transactions-contention/summary.json). The after probe additionally requires exact 409/INSUFFICIENT_SEATS responses; see [implementation and validation](transactional-reservations.md). This is a correctness comparison, not an updated throughput claim.

## Redis implementation: measured results

Each run lasts 60 seconds with the same 70% search / 20% details / 10% booking mix, 100 rotating catalog routes, and fresh booking inventory. The transaction-only controls were captured September 29; Redis runs were captured September 30 on the same local stack. These are sequential development-stage comparisons, not a same-time isolated Redis A/B experiment. Host contention can differ. Redis changes include request coalescing and bounded fallback, so improvements cannot all be attributed to cache hits alone.

| Metric | Transactions, 20/s | Redis, 20/s | Transactions, 200/s | Redis, 200/s run 1 | Redis, 200/s run 2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Issued HTTP requests | 1,202 | 1,202 | 6,721 | 11,999 | 12,001 |
| Issued requests/s including drain | 20.00 | 20.00 | 96.04 | 199.59 | 199.15 |
| HTTP failure rate | 0% | 0% | 67.77% | 30.34% | 44.42% |
| Valid business-response rate | 100% | 100% | 15.30% | 64.95% | 50.28% |
| Overall p95 latency, ms | 111.26 | 145.77 | 10,001.09 | 450.98 | 486.32 |
| Search p95, ms | 43.73 | 110.85 | 10,001.29 | 336.11 | 366.31 |
| Details p95, ms | 24.30 | 72.17 | 10,001.35 | 331.84 | 339.58 |
| Booking p95, ms | 150.56 | 266.88 | 3,138.47 | 840.11 | 819.93 |
| Dropped arrivals | 0 | 0 | 5,280 | 2 | 2 |
| All k6 thresholds passed | Yes | Yes | No | No | No |

Raw summaries and diagnostics: [transaction baseline](../load-tests/results/transactions-baseline/), [transaction 10x](../load-tests/results/transactions-10x/), [Redis baseline](../load-tests/results/redis-baseline-1/), [Redis 10x first](../load-tests/results/redis-10x-1/), [Redis 10x second](../load-tests/results/redis-10x-2/). The [analysis JSON](../load-tests/results/analysis.json) retains unrounded values.

**This does not establish 10x capacity.** Fast HTTP 503 responses lower the reported latency as well, so the p95 improvement alone is not a success criterion. The Redis runs rejected 3,641 and 5,331 reads at the fallback concurrency limit, accounting for their HTTP failures. Redis command errors/deadlines increased by 168 and 280, triggering circuit bypasses; the available counters do not distinguish deadline expiry from other command errors. Redis connection errors did not increase during either load run. Instrumenting event-loop lag and Redis round-trip latency is needed before assigning a precise cause.

Cache hits increased by 5,055 and 3,137; source reads by 2,100 and 2,329. In the first Redis run, the search SQL digest counted 1,360 searches examining about 13.93 million rows, versus 3,379 and 34.50 million in the transaction-only run. Both caching and rejected work reduce SQL volume; each remaining search still scans roughly 10,000 rows. The measured full scan remains a concrete next target for a route/price index. No index is included in this change.

At 20/s, each search route is revisited approximately every seven seconds, longer than the five-second TTL. Little search-cache reuse is expected there, and Redis adds overhead. At 200/s, repeated routes occur within the TTL. Booking flights use separate routes, so this workload does not establish hit rates for a busy search route whose inventory changes continuously.

HTTP 202 pending bookings count as HTTP successes but fail the workload's immediate-confirmation business check. Initial inventory snapshots can also show seats reserved for a still-pending booking; they are not settled corruption measurements. Reconciliation must wait for durable recovery to drain. The transaction-only 10x run and both Redis 10x runs subsequently reached zero pending bookings and zero drift. Each Redis 10x run settled at 1,199 bookings and exactly 1,199 deducted seats, verified September 30 at 13:04:51 UTC. See [settled inventory evidence](../load-tests/results/settled-inventory.json) for counts and timestamps.

Correctness validation passed: 13 cache checks, 13 reservation checks, 14 smoke checks, and a Redis-container outage check verifying reads, booking and cancellation. This validates the cache implementation and fallback at functional-test load, not outage capacity at 200/s. See [Redis design and test links](redis-caching.md).

## Composite search index

A fresh Redis-enabled control (`pre-index-10x`) was captured before applying the route/price index. The cache settings, request mix and concurrency settings were unchanged. Unlike the earlier comparison across days, these runs took place during the same September 30 session. The indexed 20/s baseline passed every threshold: 0% HTTP failures, 125.58 ms overall p95, zero dropped arrivals and zero inventory drift.

| Metric at 200 requests/s | Before index | After index, first run | After index, repeat |
| --- | ---: | ---: | ---: |
| HTTP failure rate | 34.10% | 71.25% | 70.62% |
| Valid business-response rate | 61.21% | 21.60% | 22.22% |
| Overall p95, ms | 449.58 | 672.66 | 629.06 |
| Booking p95, ms | 702.09 | 3,062.43 | 1,210.16 |
| Dropped arrivals | 0 | 41 | 23 |
| Mean search SQL time, ms | 11.51 | 1.05 | 1.02 |
| Rows examined per search SQL query | 10,304 | 100 | 100 |
| Cache hits during run | 4,563 | 529 | 433 |
| Redis command errors/deadlines during run | 204 | 549 | 547 |
| Rejected excess source reads | 4,093 | 8,522 | 8,459 |

The index fixes the observed SQL access problem, **but both end-to-end runs regressed**. It is not evidence of improved application capacity or a production-ready performance improvement. Cache errors and circuit bypasses rose while cache hits fell; the ten-load limit rejected excess reads. These counters expose the failure path but do not establish why Redis commands exceeded their deadline or failed. Flight-process CPU consumption was about 0.90 core before and 0.78 core in the first indexed run, averaged over each diagnostic interval. Event-loop delay, Redis round-trip timing and a CPU profile are needed to distinguish application work, scheduling and Redis delays before tuning limits. The index is retained in the local development stack for that next diagnostic step; the aggregate regression remains unresolved.

Raw evidence: [control](../load-tests/results/pre-index-10x/), [indexed baseline](../load-tests/results/indexed-baseline/), [indexed 10x first run](../load-tests/results/indexed-10x-1/), [indexed repeat](../load-tests/results/indexed-10x-2/), and [actual query plans](search-index-plan-results.json). See [index design and migration validation](search-index.md). Both indexed runs initially had pending bookings, so immediate inventory snapshots are not settled correctness results; use the timestamped reconciliation evidence after recovery. The repeat began after all 1,159 bookings from the first run were confirmed, with zero pending and zero drift.

Final reconciliation also confirmed all 1,178 bookings from the repeat, with 1,178 seats deducted, zero pending and zero drift. The control settled at 1,200 bookings and zero drift. Recovery preserves inventory correctness here, but does not meet the workload's immediate booking-confirmation target.
