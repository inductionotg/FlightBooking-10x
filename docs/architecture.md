# Flight Booking architecture and request flows

This document describes the **implemented local system**. Five Node.js services run on the host. Docker Compose runs MySQL, Redis, RabbitMQ, Mailpit, Prometheus, and Grafana. There is no payment service, MongoDB, read replica, or deployed AWS topology in this checkout. The 200 requests/second target has not passed; see the [measured diagnosis](200rps-diagnosis.md).

## Whole-system diagram

```mermaid
flowchart LR
  Client["Client or API caller"]

  subgraph HostServices["Host: five Node.js services"]
    Gateway["API Gateway :3010"]
    Auth["Auth :3001"]
    Flights["Flight management :3002"]
    Booking["Booking :3003"]
    Notifications["Notifications :3004"]
  end

  subgraph Docker["Docker Compose: local infrastructure"]
    subgraph MySQL["One MySQL server :33306"]
      AuthDB[(Auth schema)]
      FlightDB[(Flights schema)]
      BookingDB[(Booking schema)]
      NotificationDB[(Notifications schema)]
    end
    Redis[(Redis :36379)]
    RabbitMQ[(RabbitMQ :35672)]
    Mailpit["Mailpit SMTP :31025<br/>Inbox :38025"]
    Prometheus[(Prometheus :39090)]
    Grafana["Grafana :33000"]
  end

  Client -->|"Sign up or sign in"| Auth
  Client -->|"Authenticated flight route"| Gateway
  Gateway -->|"Validate x-access-token"| Auth
  Gateway -->|"Proxy /flightService/api/v1/*"| Flights
  Client -->|"Direct booking or cancellation"| Booking
  Client -->|"Legacy reminder ticket API"| Notifications

  Auth -->|"Users and roles"| AuthDB
  Flights -->|"Catalog and seat reservations"| FlightDB
  Flights -->|"Search and detail cache"| Redis
  Booking -->|"Booking and outbox"| BookingDB
  Booking -->|"Internal reserve/release HTTP"| Flights
  Booking -->|"Confirmed event via outbox publisher"| RabbitMQ
  RabbitMQ -->|"Consume booking event"| Notifications
  Notifications -->|"Inbox and reminder tickets"| NotificationDB
  Notifications -->|"SMTP when recipient exists"| Mailpit

  Prometheus -.->|"Scrapes metrics"| Gateway
  Prometheus -.->|"Scrapes metrics"| Auth
  Prometheus -.->|"Scrapes metrics"| Flights
  Prometheus -.->|"Scrapes metrics"| Booking
  Prometheus -.->|"Scrapes metrics"| Notifications
  Grafana -->|"Queries metrics"| Prometheus
```

Solid arrows are request, data, or event paths. Dotted arrows are Prometheus pulling metrics from services. The four database schemas share one MySQL container; the diagram does not imply four database servers. Service HTTP ports use `http://[::1]:PORT` in the local setup, while Docker UI ports bind to `127.0.0.1`. The gateway currently proxies **flight routes only**. Booking and legacy reminder APIs are called directly and must not be treated as protected by the gateway's token check. The [API reference](project-guide.md#api-reference) lists the exact routes.

| Component | What it owns |
| --- | --- |
| Gateway | Five-request/IP/two-minute rate limit, synchronous token check through Auth, and `/flightService` route proxy |
| Auth | Users, roles, sign-in, and token verification |
| Flight management | Cities, airports, flights, indexed route search, Redis cache, and transactional seat reservation/release |
| Booking | Idempotent requests, pending recovery, cancellation, confirmed booking records, and transactional outbox |
| Notifications | RabbitMQ consumer, deduplicated inbox, SMTP delivery worker, and the separate legacy reminder-ticket API |
| MySQL | Transactional source of truth for users, flights/seats, bookings/outbox, and notification state |
| Redis | Short-lived search/detail response cache; **never** decides whether a seat can be booked |
| RabbitMQ | Asynchronous confirmed-booking event delivery, retry queue, and dead-letter queue |
| Prometheus and Grafana | Scraped metrics and dashboard; they do not store logs or render distributed trace waterfalls |

## Flight search or details

```mermaid
sequenceDiagram
  participant C as Client
  participant G as Gateway
  participant A as Auth
  participant F as Flights
  participant R as Redis
  participant D as Flight MySQL

  C->>G: GET /flightService/api/v1/flights + x-access-token
  G->>A: GET /api/v1/isAuthenticated
  A-->>G: Token accepted
  G->>F: GET /api/v1/flights (traceparent forwarded)
  F->>R: Read search/detail key
  alt Cache hit
    R-->>F: Cached response
  else Cache miss or Redis unavailable
    F->>D: Indexed search or flight lookup
    D-->>F: Flight rows
    F->>R: Cache result briefly when available
  end
  F-->>G: Flight response
  G-->>C: Flight response
```

Search and detail responses have a maximum **five-second TTL**. Flight edits and committed reservations invalidate affected cache generations. If Redis is unavailable, the flight service falls back to MySQL with a bounded number of active source loads; at high load, excess reads can return 503. This is the measured failing path in the [200 requests/second investigation](200rps-diagnosis.md). A displayed cached seat count can be briefly stale, but booking checks MySQL under a row lock rather than trusting it. See the [cache design](redis-caching.md).

## Booking, recovery, and notification

```mermaid
sequenceDiagram
  participant C as Client
  participant B as Booking
  participant BD as Booking MySQL
  participant F as Flights
  participant FD as Flight MySQL
  participant Q as RabbitMQ
  participant N as Notifications
  participant ND as Notification MySQL
  participant M as Mailpit

  C->>B: POST /api/v1/booking + Idempotency-Key
  B->>BD: Save InProcess booking with request key
  B->>F: POST /api/v1/reservations + internal key
  F->>FD: Lock flight row, verify seats, deduct and save receipt
  FD-->>F: Commit reservation
  F-->>B: Reservation receipt
  alt Receipt arrives
    B->>BD: One transaction: Booked + outbox event
    B-->>C: 200 Booked
  else Timeout or transient failure
    B->>BD: Keep booking InProcess and schedule retry
    B-->>C: 202 InProcess
    loop Background recovery
      B->>F: Retry same reservation ID
      F-->>B: Original receipt or later result
      B->>BD: Confirm booking and outbox if successful
    end
  end
  B->>Q: Publish outbox event with broker confirmation
  Q->>N: booking.confirmed.v1
  N->>ND: Store deduplicated inbox entry before ack
  opt notificationEmail was supplied
    N->>M: Send SMTP message
  end
```

The flight row lock, seat deduction, and reservation receipt are one MySQL transaction. Booking confirmation and its outbox event are another transaction in the booking schema; no transaction spans both services. A stable booking ID and `Idempotency-Key` let recovery retry without deducting seats twice. Insufficient seats produce a terminal booking rejection; a 202 response means **pending**, not confirmed. The outbox publisher can retry when RabbitMQ is down, and the notification consumer records each event before acknowledging it. Mailpit captures local SMTP messages, not external delivery. See [reservation correctness](transactional-reservations.md) and [RabbitMQ delivery](rabbitmq.md).

Cancellation uses `POST /api/v1/booking/{id}/cancel` with the original key and `userId`. Booking saves cancellation intent, then asks Flights to release the reservation. The flight service restores seats and marks the receipt released transactionally. If release is delayed, the API returns 202 and recovery retries it. A confirmed-booking notification may already have been sent; cancellation notifications are not implemented.

## Observability and operational boundary

All five Node services write structured JSON logs with a `traceId`. The gateway forwards `traceparent` to Auth and Flights; Booking forwards it to Flights, and the outbox/RabbitMQ event carries it to Notifications. This lets operators correlate log records across those paths, but there is **no central trace storage/UI**. Prometheus scrapes protected `/internal/metrics` listeners and Grafana queries Prometheus for request, dependency, booking, and background-work panels. RabbitMQ queue depth is available through `node scripts/rabbitmq-status.js`, not a dashboard panel. Open the local [Grafana dashboard](http://127.0.0.1:33000/d/flight-booking-overview), [Prometheus targets](http://127.0.0.1:39090/targets), [RabbitMQ management UI](http://127.0.0.1:35673), or [Mailpit inbox](http://127.0.0.1:38025) after startup. See the [run instructions](project-guide.md#first-time-local-setup) and [monitoring details](monitoring-dashboard.md).

The current stack has one process per service, one MySQL server, one Redis instance, and one RabbitMQ instance. Horizontal replicas and a flight read replica shown in the [scaling-plan PNG](architecture-diagram-after.png) are **proposals**, not deployed components. MySQL remains the system of record; no MongoDB migration is justified by the measured access patterns. The [scaling plan](scaling-plan.md) separates implemented work from conditional next steps.
