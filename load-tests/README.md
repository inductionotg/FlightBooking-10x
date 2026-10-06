# k6 baseline audit

Normal traffic is an explicit user-approved assumption of **20 requests/second**, not measured production usage. The 10x target is **200 requests/second**. Each iteration makes one external HTTP request; booking also makes internal HTTP/database calls.

| Request | Normal | 10x |
| --- | ---: | ---: |
| Flight search | 14/s | 140/s |
| Flight details | 4/s | 40/s |
| Create booking | 2/s | 20/s |

The three constant-arrival-rate scenarios keep offering traffic when responses slow. Insufficient available virtual users appear as dropped iterations rather than silently reducing the target load. See [k6's executor documentation](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/constant-arrival-rate/).

## Prerequisites and commands

Start the existing local stack using the root README. A portable Windows k6 v2.3.0 binary is installed at `.local/tools/k6/k6-v2.3.0-windows-amd64/k6.exe`. The downloaded archive's SHA-256 was verified against the official GitHub release digest: `112276d495e5741c968e2bc09ea6196099c1275bd6db9ee0875d173c7148ce43`. Set `K6_BINARY` to use another executable; preserve the version for comparisons.

Run from the workspace root:

```powershell
./load-tests/install-k6.ps1 # Only needed when the portable binary is absent
node load-tests/run.js baseline warmup-01 10s
node load-tests/run.js baseline baseline-01 60s
node load-tests/run.js 10x tenfold-01 60s
node load-tests/run.js baseline baseline-02 60s
node load-tests/run.js 10x tenfold-02 60s
node load-tests/run.js gateway gateway-01 10s
node load-tests/run.js contention contention-01 1s
node load-tests/analyze.js
node load-tests/reconcile.js
```

Choose a new name for every run; results and fixtures are never overwritten. Execute sequentially so loads do not overlap. Wait two minutes after other gateway requests before the gateway probe; its fixed rate-limit window must be unused. Direct service load runs do not consume that limit.

The runner seeds 10,000 catalog flights over 100 origin/destination pairs (100 matches per search), reuses the catalog, and creates 20 fresh 300-seat flights per run for bookings. Booking routes are separate from catalog search routes. It uses a synthetic auth user and does not send emails or charge payments. Search keys rotate through all 100 routes; details repeatedly visit 100 flights. This is a repeatable synthetic read-heavy workload, not a replay of real user traffic. Other local smoke fixtures and earlier booking records remain; actual table counts are captured per run.

Fixtures and test credentials live under ignored `.local/`. Result JSON excludes credentials. Generated catalog/booking data remains available for inspection. The runner only seeds the dedicated local baseline databases on port 33306.

## What is measured

- k6 HTTP failure rate, business-response checks, throughput, p50/p95/p99 and endpoint latency, and dropped iterations.
- MySQL connection/activity samples each second, global counter deltas, statement-digest counts/latency/rows examined, and the flight search EXPLAIN plan.
- Host specifications, Node/k6/MySQL versions, and application process CPU/working-set snapshots (when Windows permissions allow).
- After every run, confirmed booked seats are reconciled with the actual inventory reduction, separately from HTTP success.
- With the Redis implementation, protected cache counters are captured before and after each run in diagnostics. The internal service key is never saved in the results.

Illustrative acceptance thresholds, chosen before measurement: HTTP failures below 1%, valid business responses above 99%, read p95 below 500 ms, booking p95 below 1000 ms, and zero dropped iterations. These are local test targets, not an established production SLA. A threshold failure produces a nonzero exit code but still preserves results.

Raw evidence is saved under `load-tests/results/<run>/`: `summary.json`, `diagnostics.json`, and `k6.log`. The public repository includes the JSON evidence; generated `k6.log` files remain local because they contain machine-specific paths. The summary uses k6's legacy machine-readable format explicitly for consistent parsing. The monitor adds a small amount of database traffic; query digest deltas distinguish application work. CPU snapshots are cumulative process CPU seconds; divide their delta by measured elapsed seconds to estimate core usage. The load generator and apps share one Windows host, with MySQL in Docker; results are not an AWS capacity claim.

The separate contention probe sends 20 concurrent booking attempts for one newly created flight with one remaining seat. Its duration is controlled by 20 iterations (maximum 30 seconds), not the rate-test duration argument. It should confirm at most one booking. It is a correctness test, not part of the 70/20/10 throughput comparison. Reconciliation is read-only and should run after traffic drains: requests that time out in k6 may still complete on the server. Initial and settled inventory results are preserved separately.

## Scope

Backend tests call flights and booking directly on IPv6 loopback. They do not claim gateway/auth throughput: the gateway has a five-request/IP/two-minute limit and no booking proxy. A separate gateway probe preserves and measures that policy. Payments are outside the chosen scope. RabbitMQ now receives booking events, but this workload omits `notificationEmail`, so it does not send SMTP messages. The runner itself does not change application settings. Original `before-*` runs predate transactions and Redis; `transactions-*` runs include transactional recovery; `redis-*` runs also include caching, per-process request coalescing and a ten-load fallback limit. The `diagnose-200-*` runs include the later index and RabbitMQ; the second diagnostic run samples cache deadlines and flight event-loop delay each second. The `profile-200-20261004-a` run used a temporary loopback Node inspector and a 20-second k6 workload to capture a flight CPU profile; its shorter duration and profiler overhead exclude it from capacity comparisons. The normal service launch was restored afterward. The raw profile stays in ignored `.local/profiles/`; `node scripts/summarize-flight-profile.js profile-200-20261004-a` reproduces the [sanitized counts](../docs/flight-cpu-profile-results.json).

Before/after comparisons must use the same rates, durations, data distribution, settings, versions, and host, with fresh booking inventory. Short local runs show behavior at these loads; they do not establish sustained production capacity.

The `pre-index-10x` run is a fresh Redis-enabled control before the route/price index. The `indexed-baseline` and `indexed-10x-*` runs include that index, with the cache settings unchanged. Check both HTTP failures and SQL digest metrics: a faster database query does not by itself prove higher application capacity. The repeated indexed 10x run starts only after the first run's pending bookings have drained.

## Authentication after the security retrofit

`run.js` / `prepare.js` now sign in the existing local fixture user before each run and save its one-hour token in the ignored `.local/` fixture. Booking workloads send that token; prepare a new run after it expires. Existing published measurements predate these guards. Repeat measurements to quantify the additional auth lookup; they are not evidence of post-authorization capacity.
