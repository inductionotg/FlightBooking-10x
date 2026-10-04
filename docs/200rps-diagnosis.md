# Where the 200 requests/second workload fails

Two diagnostic runs on 2026-10-01 reused the existing synthetic 70% search / 20% details / 10% booking workload, directly against the flight and booking services. The first lasted 60 seconds. The second lasted 30 seconds and added cache deadline and flight event-loop sampling; no cache TTL, concurrency limit, database index, service count or rate policy was changed. These are **diagnostic runs of different durations**, not a before/after performance improvement test. The 20 requests/second baseline and original audit remain in [before-after-metrics.md](before-after-metrics.md).

| Measure | 60-second run | 30-second instrumented repeat |
| --- | ---: | ---: |
| Issued HTTP requests | 11,502 | 5,656 |
| HTTP failure rate among issued requests | 88.23% | 87.48% |
| Valid business responses | 1.89% | 2.74% |
| Dropped scheduled iterations | 500 | 347 |
| Search + details HTTP 503 in flight logs | 9,936 | 4,777 |
| Flight cache rejected fallback loads | 9,936 | 4,777 |
| New cache hits | 0 | 0 |
| Cache command errors/deadlines | 695 (old combined counter) | 797: **786 deadline expiries**, 11 other failures |
| Late completions of timed-out cache commands | Not instrumented | **786** |
| Booking HTTP 202 responses | 1,136 | 552 |
| Booking → flight reservation errors logged | 1,155 | 562 |
| Flight reservation requests logged as client-aborted 499 | 1,154 | 561 |
| Peak sampled MySQL connections | 12 | 12 |
| MySQL max-connection errors | 0 | 0 |

Raw [60-second k6 and system data](../load-tests/results/diagnose-200-20261001-a/) and [instrumented 30-second data](../load-tests/results/diagnose-200-20261001-b/) contain summaries, MySQL/cache/process snapshots and k6 logs. k6 counts HTTP 202 as an HTTP success even though this workload requires an immediately `Booked` business response. The 503s, timeouts and 202s explain why valid business responses are lower than the HTTP success fraction. Test fixture emails and other local credentials are excluded from this document.

## Failure path seen in traces

The [saved trace examples](200rps-trace-evidence.json) show a search and a flight detail request each returning 503 at approximately 80 ms. The cache code returns this 503 when ten distinct source loads are already active. In the second run, the **4,777 flight-read 503s match exactly the 4,777 rejected-load counter increase**; the first run has the same exact match at 9,936. This is the direct response failure, not MySQL rejecting connections.

A booking trace (`c75f579384ee6a48d5665bbbfd7b50cd`) shows the booking service's flight-reservation dependency failing at roughly its three-second client timeout; booking returned 202 `InProcess`. The flight service recorded the corresponding `/reservations` request as 499 after the client disconnected. Durable recovery later confirmed that booking and published its RabbitMQ event with the original trace ID. This example demonstrates the slow reservation consequence, not an immediate booking success.

## Why the cache path collapses

The flight process spent an average **92.5% of sampled time in its event loop** during the 30-second repeat. Across 33 available one-second samples, mean p99 event-loop delay was about **388 ms**; the largest sampled delay was **887 ms**. Three cache samples were unavailable under load. The Redis client deadline is **80 ms**, far shorter than these observed scheduling delays. Of 797 cache command errors, 786 were deadline expiries and all 786 command promises completed later. Redis reported zero rejected connections and only five slow commands in its current slowlog after the repeat. These observations strongly implicate flight-process scheduling/backlog in the client-side deadlines; they do not prove that every Redis operation itself was fast or isolate which JavaScript activity consumed the loop.

The failure forms a feedback loop: deadline or circuit bypass → MySQL fallback → ten active source loads → further reads rejected with 503. In the repeat there were only 44 new source loads, 4,737 bypasses and zero new cache hits. The ten-load cap protects MySQL from unlimited read concurrency, but makes overload visible as failures. Simply raising that cap or the 80 ms timeout without measuring the loop would move or hide the queue.

MySQL is **not connection-exhausted** here: at most 12 connections were sampled and there were no max-connection errors. The indexed route search examined about 100 rows and averaged about **3.55 ms** over 36 SQL executions in the 30-second repeat; that SQL time does not explain a multi-second flight response. MySQL did record 504 row-lock waits during the repeat, so reservation contention may also contribute to slow booking calls. The flight event-loop bottleneck and cache collapse are established for failed reads; the exact share of reservation latency due to row locks versus application scheduling remains open.

## Booking correctness and boundaries

Both runs initially showed pending reservations and an apparent negative inventory drift. After recovery completed, the 60-second run had 1,136 bookings and 1,136 deducted seats; the 30-second run had 552 bookings and 552 deducted seats. Both settled with **zero** pending and **zero** drift. A negative snapshot taken while bookings remain `InProcess` is not an oversell finding.

The gateway was not exercised by this workload. Its separate measured five-request/IP policy remains a public-path blocker. RabbitMQ consumed confirmation events; the workload supplied no `notificationEmail`, so no SMTP messages were sent. There is no payment service by user decision. This diagnostic does not establish 10x capacity.

## Flight CPU profile: 2026-10-04

I started only the flight process with a loopback Node inspector, captured a V8 CPU profile while running the same 200 requests/second workload for **20 seconds**, then restored the normal launch. The [profiled k6 run](../load-tests/results/profile-200-20261004-a/) issued 3,881 requests, recorded **87.35% HTTP failures** and 121 dropped iterations. Its shorter duration and profiling overhead make it diagnostic evidence, not a comparable capacity result. After recovery, it settled at **328 booked seats, 328 deducted seats, zero pending bookings and zero inventory drift**.

The [sanitized profile counts](flight-cpu-profile-results.json) cover 20,542 samples over 33.32 seconds, including run setup/drain. Of 14,400 non-idle samples, **4,094 (28.4%)** had the structured logger on their stack. **3,644 (25.3%)** had that logger followed by Node's `SyncWriteStream._write`. The sampled stack continues through `fs.writeSync` to native `writeBuffer`: [observability.js](../FlightandSearchService/src/observability.js) writes a JSON line to `process.stdout` per request, and this local Windows launch redirects stdout to a file. The profile therefore identifies synchronous log output as a substantial source of flight-process event-loop occupancy under this deployment. MySQL2 appeared in 773 active samples (5.4%), flight-cache code in 571 (4.0%), Express JSON serialization in 609 (4.2%) and garbage collection in 137 (1.0%). These are **inclusive, overlapping stack counts**, not additive CPU percentages or shares of request latency.

This explains a credible contributor to the long event-loop delays and downstream 80 ms Redis client deadlines, but does not prove every timeout was caused by logging. The reservation path also has measured row-lock waits. The profile is specific to this local Windows file-redirection setup; production stdout handling must be measured separately. The raw profile is kept in ignored `.local/profiles/profile-200-20261004-a.cpuprofile`, and [the summarizer](../scripts/summarize-flight-profile.cjs) regenerates the reviewable counts without exposing request data.

## Next controlled change

Remove synchronous stdout writes from the flight request path while retaining structured logs and trace IDs, then rerun the same **20 and 200 requests/second** tests with identical durations and fixtures. Compare flight event-loop delay, Redis deadline/late-completion counters, cache hits, 503s, valid business responses and settled inventory. Keep the ten-load bound and short availability TTL until those measurements justify changing them.

The added [cache counters](../FlightandSearchService/src/utils/flight-cache.js) distinguish deadline expiries, other command failures, late completions and event-loop delay. The [k6 runner](../load-tests/run.cjs) now samples them every second. The 13 existing Redis integration checks passed after this diagnostic-only instrumentation was activated.

The final reconciliation is stored in [settled-inventory.json](../load-tests/results/settled-inventory.json). It preserves the historical pre-transaction drift separately from the zero-drift diagnostic runs.
