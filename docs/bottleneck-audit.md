# Bottleneck audit — before Redis/RabbitMQ

Measured 2026-09-29. Normal traffic of **20 external requests/second** was explicitly approved by the user as a local baseline assumption; the target is **200 requests/second**. This is not production traffic telemetry. No cache, queue, indexes, service scaling, pool changes, or rate-limit changes were introduced for these runs. The previously documented gateway path and fresh-migration repairs are baseline prerequisites.

## Method and environment

- k6 v2.3.0, Windows amd64, Node v22.14.0, MySQL 8.0.46 in Docker Desktop.
- Intel Core Ultra 7 155U, 14 logical CPUs, 15.48 GiB host RAM. Docker reports 14 CPUs and 8,049,594,368 bytes available RAM. MySQL container has no additional explicit CPU or memory limit (HostConfig values both zero); the Docker VM still bounds its resources.
- One process per existing application; default Sequelize pools. MySQL max_connections = 151. Apps and k6 share the host; other local processes exist. CPU snapshots and run configuration are saved in diagnostics.
- 10,000 catalog flights across 100 route pairs; searches return 100 flights. Each run has 20 fresh booking flights with 300 seats each. Earlier test fixtures remain; total flight counts are 10,043 / 10,063 / 10,083 / 10,103 in the four main runs. This small growth is recorded rather than hidden.
- Mix: 70% filtered searches, 20% flight details, 10% one-seat bookings. Three independent constant-arrival-rate scenarios; 10-second client request timeout; up to 15 seconds graceful completion. Baseline preallocates 34 VUs, maximum 150; 10x preallocates 200, maximum 1,000.
- Chronological order: 10-second warm-up, baseline 1, 10x 1, baseline 2, 10x 2, gateway probe, contention probe. Each main run offers traffic for 60 seconds. The second baseline is also a recovery observation after overload; these are short local runs, not independent production-capacity trials.
- Predeclared targets: HTTP failures <1%, business success >99%, read p95 <500 ms, booking p95 <1,000 ms, zero dropped iterations.
- Backend workload calls the flight and booking services directly. It does not silently bypass the gateway and claim end-to-end capacity: the gateway is measured separately. There is no gateway booking route, payments service, or booking-to-notification integration in this checkout.

See [load-test instructions](../load-tests/README.md) and [k6 constant-arrival-rate documentation](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/).

## Actual results

| Measure | Baseline 1 | Baseline 2 | 10x 1 | 10x 2 |
| --- | ---: | ---: | ---: | ---: |
| Target external requests/s | 20 | 20 | 200 | 200 |
| Issued/completed HTTP requests, including failures | 1,203 | 1,203 | 6,980 | 6,674 |
| Observed requests/s, including failures and drain time | 20.03 | 20.04 | 99.71 | 95.34 |
| Successful HTTP responses/s over same interval | 20.03 | 20.04 | 49.67 | 58.83 |
| HTTP failure rate among issued requests | 0% | 0% | 50.19% | 38.30% |
| Overall p95 | 39.33 ms | 232.46 ms | 10,002.15 ms | 10,000.77 ms |
| Search p95 | 30.29 ms | 181.55 ms | 10,001.96 ms | 10,000.73 ms |
| Flight details p95 | 15.88 ms | 124.56 ms | 10,002.37 ms | 10,000.84 ms |
| Booking p95 | 95.74 ms | 408.86 ms | 10,003.27 ms | 10,000.79 ms |
| Dropped iterations (never issued) | 0 | 0 | 5,022 | 5,328 |
| Peak sampled MySQL connections | 6 | 9 | 11 | 11 |
| MySQL max-connection errors | 0 | 0 | 0 | 0 |
| Confirmed seats missing from inventory deduction, after settling | 0 | 0 | 462 | 459 |

Requests at scenario boundaries account for the small excess over exactly 1,200 nominal baseline requests. k6 throughput includes approximately 10 seconds of draining after overloaded 60-second runs. Do not describe 95–100 requests/s as successful capacity. Dropped iterations are separate from the reported HTTP error percentages. Error rates are among issued requests, not all scheduled arrivals. Threshold failures intentionally produced k6 exit code 99.

Latency varies substantially even between the two successful baselines. Preserve both runs and their order; do not use the fastest result as a universal claim. The 10x failures and inventory corruption reproduced in both runs.

## What breaks first, and what the evidence supports

### 1. The public gateway rejects normal single-client traffic

At 20 flight requests/s for 10 seconds from one source IP, the gateway returned **5 HTTP 200 responses and 196 HTTP 429 responses**: 97.51% rejected. There was also one successful authentication request in k6 setup, so the global HTTP request count is 202, while the gateway count is 201. This is the configured five-request/IP/two-minute policy, not a database performance failure. The short probe's counter-only thresholds intentionally pass; its exit code does not mean 20/s is supported through the gateway.

Evidence: [gateway summary](../load-tests/results/before-gateway/summary.json). Before claiming public 10x capacity, define an appropriate authenticated-client rate policy, then test it separately. Increasing this limit alone does not fix backend failure.

### 2. Flight reads become the shared overloaded path at 10x

Both flight endpoints and booking reach the 10-second client timeout; booking depends synchronously on flight reads and inventory updates. The flight process consumed **62.86 CPU seconds over 70.92 seconds** in run 1 and **61.16 over 71.15 seconds** in run 2, approximately 0.89 and 0.86 CPU cores averaged across the observation. Its working set rose from about 93 to 278 MiB in run 1 and 96 to 251 MiB in run 2.

This supports an application-side throughput/queueing problem in the flight path, with expensive repeated reads. It does **not** isolate exactly how CPU time divides between Sequelize result handling, JSON serialization, logging, and other runtime work; no CPU profile or event-loop trace was collected. The generator also shares the host and reached about 1,067 MiB working set in the sampled second 10x run. VU limits were reached; dropped arrivals show the configured generator could not sustain the offer under these response times, not that 200 requests/s were successfully delivered throughout. Recheck with a separate generator for production sizing.

MySQL connections never approached 151 and max-connection errors stayed zero. No captured connection-acquisition error establishes pool exhaustion. Increasing database connection limits is therefore not justified by this evidence.

### 3. Search repeatedly scans the entire flight table

The actual search plan is `type=ALL`, `possible_keys=null`, `key=null`. Existing indexes cover primary key and unique flight number, not airport/price filters.

| Search SQL evidence | Baseline 1 | 10x 1 | 10x 2 |
| --- | ---: | ---: | ---: |
| Executions within sampled interval | 841 | 4,497 | 4,663 |
| Total rows examined | 8,446,163 | 45,253,311 | 47,110,289 |
| Rows examined per execution | 10,043 | 10,063 | 10,103 |
| Mean SQL execution time | 5.04 ms | 13.25 ms | 12.66 ms |

Each search returns 100 rows while examining the full table. Only 100 search keys are exercised repeatedly. This directly motivates testing an airport/price composite index and Redis search caching. Repeated detail lookups motivate the second cache endpoint, but their SQL primary-key lookup averages about 0.54–0.58 ms at 10x; detail caching is a smaller SQL saving and must be measured separately. SQL execution time is not end-to-end latency: these averages alone do not explain the full 10-second timeout.

### 4. Inventory updates are unsafe under concurrency

After traffic drained, 10x run 1 had **629 confirmed seats but only 167 seats deducted**; run 2 had **625 confirmed seats but only 166 deducted**. Neither had remaining InProcess records at final reconciliation. Initial snapshots can differ because the server continues work after client timeouts; both initial and settled evidence are retained.

A separate k6 probe sent 20 concurrent one-seat booking attempts to a new flight with only one available seat. **All 20 returned successful bookings; the database deducted one seat.** This deterministically observed overselling in this run, independent of HTTP failures. The Bookings table confirms the 20 records.

The source reads availability, inserts a booking, then overwrites inventory with an absolute value based on the earlier read. Concurrent requests overwrite each other's deductions. Fix this with an atomic conditional reservation and a failure/retry strategy before caching availability. A Redis TTL or RabbitMQ notification queue cannot solve this race.

Evidence: [contention summary](../load-tests/results/before-contention/summary.json), [settled inventory](../load-tests/results/settled-inventory.json).

## Changes justified for the next stage (not implemented here)

1. Atomic inventory reservation plus idempotent/recoverable booking behavior: justified by confirmed inventory corruption and bookings completing after client timeout.
2. Test a route/price index and Redis on the two read endpoints: justified by full scans, repeated queries, and overloaded flight reads. Measure each improvement; do not assume a particular speedup.
3. Structured logging/tracing with timings for the flight/booking path: distinguish application queueing from SQL time and remove the existing secret-bearing log statements. CPU profiling is needed before attributing saturation to logging specifically.
4. Revisit gateway rate policy explicitly: justified by 429 results, independently of backend capacity.
5. RabbitMQ/outbox notifications are a missing integration to design, **not a measured performance fix**: current booking does not call notifications, and payments is absent. No payment or queue bottleneck was observed or invented.

## Evidence and boundaries

Raw runs: [baseline 1](../load-tests/results/before-baseline-1/summary.json), [baseline 2](../load-tests/results/before-baseline-2/summary.json), [10x 1](../load-tests/results/before-10x-1/summary.json), [10x 2](../load-tests/results/before-10x-2/summary.json). Each directory also contains `diagnostics.json` and `k6.log`. [Analysis JSON](../load-tests/results/analysis.json) includes database digest deltas and process CPU snapshots. Measurements use local synthetic data, not a production system. MySQL monitoring adds a small amount of traffic. No after-change measurement exists yet; retain these artifacts for the comparison.
