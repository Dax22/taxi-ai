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

## Matching validation milestone

CI now has a `PostgreSQL concurrency and journeys` job against native PostgreSQL
16/PostGIS. `npm run test:postgres` refuses a missing database or a server without
independent backends; it runs all PostgreSQL integration suites sequentially.
The concurrency suite deliberately races separate pools: serialization retries,
one pending offer per ride and per driver, competing leases, stale workers after
routing, and transactional rollback. Existing PostgreSQL browser/native, Eats,
family/courier and admin suites run in the same gate. Configure this job as a
required check in GitHub branch protection if repository settings do not already
require every verification job. A workflow job alone does not change protection.

### Sample matching queries in staging

Set `TAXI_AI_DISPATCH_PROFILE_SAMPLE_EVERY=10` on workers to sample every tenth
regional cycle (0, the default, disables profiling; 1 profiles every cycle).
Structured `dispatch_profile` logs contain total and phase duration in milliseconds
(discovery including stale-offer cleanup, routing, and commit), database operation
count/time, transaction retries, and at most 65 query fingerprints. Database time
includes adapter/pool wait and retry work; it is not PostgreSQL CPU time. Transaction
BEGIN/COMMIT statements are not separate query counts. SQL, parameters, rider/driver
IDs, coordinates and region names are never logged. Fingerprints are the first
16 hexadecimal characters of SHA-256 of `method:normalized SQL`; method is
`get`, `all`, `run`, `exec`, or `query`, and normalization collapses whitespace and
trims ends. Derive the same fingerprint from repository statements to locate
repeated or slow queries, then use EXPLAIN (ANALYZE, BUFFERS) only on the disposable
benchmark database. Profiling does not change matching policy or expose an endpoint.

### Run the isolated benchmark on a staging host

Provide a dedicated, disposable native PostgreSQL 16+/PostGIS database on
loopback named `taxi_ai_load` (or another `taxi_ai_load*` / `taxi_ai_test*` name).
Its role needs schema creation and the PostGIS/citext extensions, as for database
integration tests. Keep this database separate from the invited pilot database.
Do not run resource-heavy benchmarks alongside live operations on a shared host.

```sh
export TAXI_AI_LOAD_POSTGRES_URL='postgresql://test_role:TEST_PASSWORD@127.0.0.1:5432/taxi_ai_load'
npm run matching:benchmark -- --rate 1 --duration-seconds 60 \
  --warmup-seconds 10 --actors 40 --api-instances 2 --workers 2 \
  --pool-size 10 --max-match-p95-ms 10000 --output matching-baseline.json
```

Each run creates/drops a unique schema and starts independent API and worker
processes with separate pools; requests alternate between APIs using real
session/CSRF/idempotency controls. Synthetic drivers pass normal onboarding.
Fixed-rate arrivals create GPS quotes and requests while drivers poll, accept
matches, negotiate fare, verify pickup PINs and complete journeys. Idle drivers
send GPS heartbeats. Providers use deterministic fixtures; no real messages,
payments or routing calls are sent. No existing website URL is accepted.

The report separates setup, warmup, the arrival window and drain time. It includes
HTTP errors/percentiles, scheduled/started/dropped arrivals, generator scheduling
lag, completed journeys, request-to-accepted-offer percentiles, per-process memory,
event-loop delay, sampled pool queue peaks and matching query/phase profiles.
It exits nonzero for any dropped arrivals, incomplete/error journeys, HTTP error
rate over 1%, p95 accepted-match latency above the chosen limit, missing commit
profiles, profile overflow, or unhealthy warmup. CI runs a small two-API/two-worker
smoke workload; that validates the harness, not capacity.

Increase load in recorded stages on representative staging hardware. Actors are
bounded at 200 customer/driver pairs, arrivals at 20/s, duration at five minutes,
and total service pool connections at 80. Both customer and driver reuse waits
15 seconds to respect account write budgets. Too few available actors causes
explicit dropped arrivals; the generator never waits for capacity. Save reports
with unique filenames (existing reports are not overwritten), commit SHA and host
CPU/RAM/database version alongside each run. `--idle-accounts 1000000` can test
account-table cardinality using synthetic inactive rows; it does **not** simulate
one million active users, driver locations, or trip-history rows.

Before claiming production capacity, repeat longer distributed tests for the
expected active riders/drivers, city distribution, historical rides, realtime
connections, real routing service latency/quotas, and worker/database failure.
This milestone supplies concurrency evidence and a bounded repeatable benchmark;
it does not certify one-million-user operation or change the deployed topology.

## Opt-in faster matching

`TAXI_AI_MATCHING_FAST_PATH=true` enables bounded batch eligibility reads, fresh
batch revalidation within the existing assignment transaction, compact pickup
routing tables, and PostgreSQL worker wakeups. The default is `false`. Set the
same configuration on every API and worker. Optionally set
`TAXI_AI_MATCHING_FAST_REGIONS=ng:181:148` to enable batch reads and wakeups only
for selected request regions. An empty list selects all regions. Routing matrix
compaction is process-wide when enabled; it preserves the requested directed
pairs and does not change fare negotiation or matching policy.

The internal matching projection reads only the fields needed for driver
eligibility, session validity, current availability, vehicle compatibility,
parcel recipient exclusions and existing work. It uses the existing driver
document and vehicle domain policies. It does not cache approvals or busy state
across cycles. Assignment rereads current records inside the SERIALIZABLE
transaction after acquiring the lease guard. One pending offer per driver/ride,
movement checks, location expiry and all claim-time checks remain enforced.

PostgreSQL migration `014_dispatch_wakeups.sql` adds commit-time notification
triggers. They emit coarse region hints only when the writing connection has
the flag enabled. Requested rides, offers and availability remain durable in
their existing tables; notifications are not a work queue. Workers coalesce
bursts, include neighboring pickup cells, filter empty regions, bound pending
hints, and retain periodic scans for startup, disconnects and lost hints. Each
enabled worker uses **one additional database connection** for LISTEN, outside
its normal pool. API-only processes do not subscribe or acquire worker leases.
LISTEN requires a direct or session-pooled connection; transaction-mode poolers
are not supported for this listener. Selected regions filter processing, while
enabled API connections still emit cheap notifications for other regions.
SQLite retains periodic scheduling and can exercise the batched matching path.

Deploy the additive database migration and code with the flag off first. Enable
one selected region and inspect matching query profiles, retries, request-to-offer
delay and concurrent ride/Eats/courier behavior before widening the region list.
Set the flag to `false` and restart APIs/workers to restore the original matching
path without removing tables or changing existing journeys. Keep the current
release/schema for this configuration rollback; an older binary is not a schema
downgrade strategy.

### Compare the two paths

Run the same isolated workload twice on the same host, with unique output names:

```sh
npm run matching:benchmark -- --rate 1 --duration-seconds 60 --warmup-seconds 10 \
  --actors 40 --api-instances 2 --workers 2 --pool-size 10 \
  --fast-path false --output matching-before.json
npm run matching:benchmark -- --rate 1 --duration-seconds 60 --warmup-seconds 10 \
  --actors 40 --api-instances 2 --workers 2 --pool-size 10 \
  --fast-path true --output matching-after.json
node scripts/compare-matching-benchmarks.mjs matching-before.json matching-after.json
```

The comparison rejects failed runs or mismatched workloads, and reports dispatch
query totals per completed journey. That avoids making improvements appear larger
by counting extra idle worker cycles. Query totals cover profiled dispatch work;
they exclude ordinary HTTP queries and the wakeup region lookup. Accepted-offer
latency includes the synthetic driver's one-second polling interval and is not a
pure matching calculation time. CI runs both paths with six measured arrivals,
two APIs and two workers. Real routing latency, large historical tables and
sustained saturation still require representative staging tests.
