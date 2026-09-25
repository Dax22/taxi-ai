# Scaling Taxi Ai

These changes add a PostgreSQL deployment path, multiple API processes, separate
matching/maintenance workers, bounded location queries and reproducible load
tests. They do **not** establish capacity for one million users. Registered
accounts, active riders, online drivers, concurrent event connections and trip
requests per second are different workloads and must be measured separately.

## Deployment choices

| Development | Scaling environment |
| --- | --- |
| SQLite on local disk; one combined process | PostgreSQL 16+ with PostGIS 3 and citext |
| `npm run dev` | Two API replicas, separate workers and Caddy |
| `TAXI_AI_PROCESS_ROLE=all` | `api` for HTTP, `worker` for background processing |
| In-process database file | Shared PostgreSQL with asynchronous pooled connections |
| Maps off or reviewed community preview | Explicit dedicated search, route and tile endpoints |

Existing SQLite installations keep working; selecting PostgreSQL does not copy
their users or journeys. Never point two replicas at the same SQLite file or put
it on a shared network filesystem. PostgreSQL schema creation is a deliberate
operator command, separate from ordinary application startup:

```bash
npm run db:postgres:migrate
```

Use `TAXI_AI_DATABASE_URL` for the database connection and
`TAXI_AI_DATABASE_POOL_SIZE` for each process's pool size. Runtime credentials
should have only the table/sequence privileges required by the application.
Migration credentials stay with the operator. The migration command supports
`--grant-app-role taxi_app` to grant the runtime role access after schema changes.
See the PostgreSQL migration documentation for data migration and verification.

## Reference topology

`deploy/scale/compose.yml` prepares an **invited staging** environment:

```mermaid
flowchart TD
  Clients["Web, iOS and Android"] --> Gateway["Caddy HTTPS gateway"]
  Gateway --> A["API A"]
  Gateway --> B["API B"]
  A --> Database["PostgreSQL and PostGIS"]
  B --> Database
  Workers["Matching and maintenance workers"] --> Database
```

Sessions, idempotency records, rate limits, offers and worker coordination are
stored in the shared database. Requests can reach either API replica. The gateway
overwrites the canonical Host, proxy token, forwarded protocol and client IP;
the app validates the same staging boundary as the single-instance deployment.
The app and database have no published host ports. The public gateway rejects
health routes; Docker probes API readiness over loopback. Passive gateway health
checks temporarily exclude failing replicas, and automatic retries are limited
to GET/HEAD. Streaming responses flush promptly.

Browser and native clients use authenticated long polling for account-change
signals, with a slower refresh fallback. The gateway allows 35 seconds for
upstream response headers, covering the 25-second event wait. Account revisions
are stored in PostgreSQL and observed by each API replica; no sticky session is
required. See [realtime updates](realtime-updates.md) for reconnect behavior,
pending-request limits and the distinction between a change signal and durable
delivery of an individual business event.

The template places all containers on one host. It is **not** a highly available
database, multi-host cluster or managed cloud installation. Host failure still
interrupts service. No cloud account, paid resource or public domain is created
by this repository.

To use the template on an approved test host:

1. Copy `deploy/scale/.env.example` to `deploy/scale/.env` and set its DNS name.
   Generate a different `openssl rand -hex 32` value for each of the three
   secrets. Hexadecimal database passwords avoid URL-encoding ambiguity. Keep
   the file private with mode 0600. Never publish expanded Compose configuration
   because it contains credentials.
2. Create tester access using the existing staging command:

   ```bash
   npm run staging:access -- add owner deploy/scale/secrets/staging-testers.json
   chmod 700 deploy/scale/secrets
   chmod 644 deploy/scale/secrets/staging-testers.json
   ```

   The JSON contains hashes, not the printed access key. The non-root app must
   be able to read it; alternatively retain mode 0600 with UID 1000 ownership.
3. Build and start from the repository root:

   ```bash
   docker compose --env-file deploy/scale/.env -f deploy/scale/compose.yml build
   docker compose --env-file deploy/scale/.env -f deploy/scale/compose.yml up -d
   docker compose --env-file deploy/scale/.env -f deploy/scale/compose.yml ps
   ```

   PostgreSQL first creates `taxi_app` with no superuser, role-creation or
   database-creation privileges. A one-shot migration container applies schema
   changes using `taxi_owner`, grants runtime DML privileges, then exits. API and
   worker startup wait for successful migration. The owner account is privileged
   and belongs only to migration/bootstrap containers; APIs use `taxi_app`.
4. Check both API health states and worker lease progress. Test login across
   alternating replicas, offer acceptance, reconnects, fare agreement and trip
   completion before inviting testers. Stop one API and repeat the journey.
   Then restart a worker during matching and confirm another worker can take
   over after its lease expires, without duplicate live offers.

The first PostgreSQL initialization runs only on a new volume. Changing password
environment variables later does not rotate database passwords. Use a reviewed
database credential rotation procedure. Resolve and pin tested container image
digests before rollout. Database backups need encrypted off-host storage and a
tested restore; the single named volume in this example is persistence, not a
backup. Do not run `docker compose down -v` during a routine upgrade.
The selected official PostGIS image is amd64; Compose selects that platform
explicitly. Apple Silicon can use Docker's emulation for a local preview, but
emulated timings must not be used to size a native cloud host. Review the
[image's supported versions and architectures](https://hub.docker.com/r/postgis/postgis)
when choosing deployment hardware.

Pool capacity is per process: two APIs and one worker with pool size 10 can use
30 connections, plus migration and operator connections. Keep a database
connection reserve and measure pool wait time before increasing replica counts.

## Workers and routing capacity

Set `TAXI_AI_PROCESS_ROLE=api` on HTTP replicas and run
`TAXI_AI_PROCESS_ROLE=worker npm start` for background processing. Workers discover active
geographic partitions with `TAXI_AI_WORKER_REGIONS=auto`; controlled regional
assignments can use a comma-separated list. `TAXI_AI_WORKER_CONCURRENCY` bounds
the number of partitions a process works on concurrently. Durable leases permit
multiple workers to coordinate; maintenance is separately coordinated. Lease
expiry provides takeover, not exactly-once delivery to external providers.

The worker process serves only health endpoints; business requests are rejected.
The Compose template uses the image's loopback health probe for readiness.
Process/database readiness alone does not prove progress: monitor lease heartbeats, offer backlog/age, expired
requests and maintenance failures. Configure actual alert delivery before live
operation.

Public community map endpoints are suitable only for the existing small preview
budget. With provisioned capacity use `TAXI_AI_MAPS_MODE=dedicated` and configure:

| Setting | Required service |
| --- | --- |
| `TAXI_AI_SEARCH_URL` | Photon-compatible place search |
| `TAXI_AI_ROUTING_URL` | OSRM route endpoint ending in `/route/v1/driving` |
| `TAXI_AI_TILE_URL` | Reviewed XYZ tile template |
| `TAXI_AI_MAPS_API_KEY` | Optional backend-only provider bearer token |
| `TAXI_AI_MAPS_REQUESTS_PER_SECOND` | Request budget per process |
| `TAXI_AI_MAPS_MAX_CONCURRENT` | Concurrent provider calls per process |

Provider limits are local to each process: the sum of all API/worker budgets
must fit the provider contract. Dedicated mode does not supply live traffic,
provision an OSRM/Photon service or enable an ML ETA model. A provider outage
must continue to produce an explicit distance fallback rather than a fabricated
road ETA.

## Reproducible development load tests

The runner uses Node built-ins, a separate load-generator process and real
loopback HTTP. It creates synthetic customer/driver accounts, fictional
onboarding documents and valid server sessions in a new disposable database.
Public request authentication, CSRF, rate limits, idempotency, driver eligibility,
fare agreement and pickup PIN checks remain enabled. Seeding and password
hashing happen before measurement; this does not benchmark signup/login capacity.

```bash
npm run load:test -- --scenario read --concurrency 25 --duration-seconds 30 --warmup-seconds 5 --think-ms 100
npm run load:test -- --scenario heartbeat --concurrency 25 --duration-seconds 30 --warmup-seconds 5 --think-ms 5000
npm run load:test -- --scenario journey --concurrency 10 --duration-seconds 30 --warmup-seconds 5 --think-ms 15000
npm run load:test -- --scenario events --concurrency 25 --duration-seconds 30 --warmup-seconds 5 --think-ms 250
```

| Scenario | Measured work |
| --- | --- |
| `read` | Authenticated session/profile and customer ride-list reads |
| `heartbeat` | GPS availability updates and driver work discovery |
| `journey` | Quote, request, GPS heartbeat, timed offer, claim, explicit fare acceptance, confirmation, pickup PIN and completion |
| `events` | Authenticated account-change waits with retained cursors and up to 25-second long polling |

`concurrency` is the number of synthetic rider/driver pairs, not a claim about
concurrent real users. The read scenario uses the riders; heartbeat uses the
drivers. Journey requests start as a cohort and exercise shared matching across
those accounts. Fast synthetic journeys are paced at least 15 seconds apart
to respect the real per-account write limit. No payment, SMS, email, push,
emergency or public map provider is called; route responses are deterministic
fixtures.

For PostgreSQL, create a **separate local test database**, for example
`taxi_ai_load`, with PostGIS/citext available and a test migration-capable role.
Set `TAXI_AI_LOAD_POSTGRES_URL` to its loopback connection URL, then run:

```bash
npm run load:test -- --database postgres --scenario journey --concurrency 10 --duration-seconds 30 --warmup-seconds 5
```

Use `--pool-size 10` to choose a bounded PostgreSQL connection pool for the run;
the selected value is recorded in the report. Capacity comparisons must keep
pool configuration consistent.

Only loopback PostgreSQL database names starting with `taxi_ai_load` or
`taxi_ai_test` are accepted; URL query overrides are rejected. Each run creates
and drops its own randomly named schema. It never clears existing schemas or
tables. A forcibly terminated test can leave its own schema behind for an
operator to inspect and remove. Normal completion removes the schema and
temporary SQLite directory. The default test ignores existing `.env` files,
database settings and provider credentials.

Append `--output /absolute/new-report.json` to preserve a shareable report.
Existing files are never overwritten. Reports contain counts and timings, not
session tokens, account addresses, PINs, coordinates or database credentials.
They include separate warmup/measurement periods, per-operation p50/p95/p99,
status/error counts, throughput, completed journeys, time to accepted offer,
server event-loop delay and memory. HTTP and scenario failures make the command
exit nonzero. An error-laden run is not usable evidence of supported throughput.
The `events` latency includes the intended idle wait; a 25-second successful
long poll does not mean ordinary API requests take 25 seconds.

The runner deliberately bounds concurrency to 200 pairs and measurement to five
minutes. It accepts no target website URL or existing SQLite path. It is a
closed-loop development benchmark, not an open-loop, multi-machine stress tool.
It does not reproduce mobile radios, internet latency, public routing quotas,
internet-scale event connection counts, TLS termination or production-sized history.

## Capacity acceptance

Verification on **2026-09-25**, using Node 24.19.0 in the development workspace:

| SQLite journey run | HTTP requests | HTTP errors | Completed journeys | Request p95 | Request p99 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Previous code, commit `8b5af51` | 70 | 0 | 5 | 27.75 ms | 44.21 ms |
| Scaling implementation working tree | 70 | 0 | 5 | 33.01 ms | 53.38 ms |

Both used the same runner, five rider/driver pairs, a two-second warmup followed
by a five-second measurement, a separate local server process and deterministic
road-estimate fixtures. Both produced five road-ranked offers and completed
explicit fare agreement, confirmation and pickup-PIN checks. These tiny paced
runs validate the tool and application path; the measurements do **not** show a
speed improvement or establish supported capacity. Timing variation, asynchronous
coordination overhead and other workspace jobs are not isolated by this setup.
The read, heartbeat and event-wait scenarios also completed without HTTP errors.

A separate two-pair fare/PIN journey completed **28 HTTP requests, zero HTTP
errors and two journeys** through the native `pg` adapter connected over TCP to
PGlite with PostGIS and a one-connection pool. PGlite is an embedded PostgreSQL
test engine with a single backend; this run checks SQL compatibility and the
application flow. It does not establish native multi-session isolation, pool
contention behavior or hosted performance. Native PostgreSQL concurrency remains
a required validation gate. The Compose file was parsed and checked, but its
containers have not been started on a Docker host in this environment. Multiple
API/worker processes and the actual gateway still require the staging checks
below before rollout.

Record the exact commit, machine/container CPU and memory limits, database size,
provider configuration, scenario mix, client pacing, warmup, run duration and
results. Compare the same workload on the same machine; do not compare a paced
journey run with an unpaced read run. A short development run verifies the
measurement path and may identify regressions; it cannot justify a user-count
promise.

Before a capacity claim, use an isolated staging installation with production
sized synthetic history and measure increasing request arrival rates, active
drivers and sustained event connections. Include saturation and recovery,
database/network failures, API replacement, worker takeover, provider latency,
concurrent claims and replica-wide rate limiting. Agree measurable gates such
as p95/p99 request latency, matching delay, error rate, event-delivery lag,
database pool wait and successful-trip percentage before the run. Confirm
off-host backup/restore and operational alerting on the actual hosting platform.

Deploying this template, training a matching model and claiming one-million-user
capacity are separate decisions. None is implied by a passing unit-test suite.
