# Private staging and recovery

This release prepares Taxi Ai for an invited testing group. It adds deployment
configuration and operator commands; it does not provision a host, register a
domain, publish the website or enable real transport services. Use test accounts
and test journeys. The default `npm run dev` experience remains on localhost.

## Runtime boundary

| Setting | Local default | Staging requirement |
| --- | --- | --- |
| `TAXI_AI_MODE` | `local` | `staging`; required when `NODE_ENV=production` |
| `PORT` | `3000` | Valid port; reference container uses `3000` internally |
| `TAXI_AI_BIND` | Always `127.0.0.1` | `127.0.0.1`, or `0.0.0.0` on an isolated container network |
| `TAXI_AI_PUBLIC_ORIGIN` | Derived from loopback Host | One HTTPS DNS origin, without path/query/credentials |
| `TAXI_AI_DB` | Ignored `data/taxi-ai.sqlite` | Explicit absolute path on persistent local storage |
| `TAXI_AI_PROXY_TOKEN` | Unused | 32 random bytes encoded as 64 lowercase hex characters |
| `TAXI_AI_STAGING_ACCESS_FILE` | Unused | Absolute path to the invited-tester hash file |
| `TAXI_AI_MAPS_MODE` | `community` | Defaults to `off`; enable a reviewed provider for map tests |
| `TAXI_AI_CALLS_MODE` | `local` | Defaults to `off`; hosted calling requires configured `relay` mode |

`npm run config:check` validates settings without printing credentials. It does
not test disk persistence, provider connectivity or a deployed TLS certificate.
Staging refuses incomplete settings and an empty/invalid tester file. The
reference Docker image defaults to staging and fails closed without configuration.

The gateway terminates HTTPS and overwrites the canonical Host, forwarding
protocol, client IP and private proxy token. The app validates all of these before
serving content. Forwarded Host is ignored; a comma-separated forwarding chain is
rejected. Only a request authenticated as coming through that gateway supplies a
client IP for rate limiting. Local mode always uses the socket address.

The reference gateway is the internet-facing edge. Adding a CDN, another proxy,
load balancer or multiple app replicas requires a reviewed configuration change.
Keep the app port private; a proxy token is an additional boundary, not a reason
to expose plaintext HTTP. Caddy's [header controls](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers)
support explicit overwrites rather than trusting a client's forwarding headers.

## Invited testers and accounts

Run this from the repository root to create one tester credential:

```bash
npm run staging:access -- add owner deploy/staging/secrets/staging-testers.json
```

The command prints a newly generated access key once and stores only its SHA-256
hash with a short tester alias. Keys have 256 bits of random entropy; they are
not human-selected passwords. Store/share each key through your chosen private
channel. No invitation email is sent. Do not reuse the proxy token as a tester key.
Up to 50 tester aliases are allowed. Duplicate names fail without replacing a key.

At the staging URL, the browser first asks for the tester alias and access key.
After that, the tester registers/signs into their normal customer or driver
account. This gate limits access to the whole preview, including HTML/assets;
account sessions still enforce roles, driver approval and participant ownership.
The administrator bootstrap command remains operator-only. Email delivery defaults
off, so a business sender is not required for preview accounts. Optional
[SMTP setup](account-email.md) enables verification and customer/driver password
recovery. Verification is informational in this invited preview; live-service
verification requirements still need to be enforced before launch.

Staging account cookies use `__Host-taxi_ai_session`, Secure, HttpOnly,
SameSite=Strict and Path=/, with no Domain. Local cookie names are not accepted.
Origin and session-bound CSRF checks still protect writes. Signing out clears the
account session; browsers may keep the separate HTTP Basic tester credential
until the browser profile is closed. Use separate profiles for separate people.
No account tokens or tester keys are stored by app JavaScript in localStorage.

To revoke a tester:

```bash
npm run staging:access -- remove owner deploy/staging/secrets/staging-testers.json
```

Recreate/restart the app to reload its access file; removal is not live until then.
It blocks the gate, but does not individually delete that person's account or
sessions, since tester aliases are not tied to account identities. Removing the
last tester makes the next staging startup fail closed. Add a replacement first
when rotating access. Rotate the proxy token in both app and gateway together.

## Reference deployment

`Dockerfile` and `deploy/staging/compose.yml` provide one non-root Node app,
a Caddy HTTPS gateway and named volumes for app data, backups and certificates.
Only gateway ports 80/443 are published. The app has a read-only root filesystem,
restricted capabilities, resource limits and a writable private `/data` volume.
Use local persistent disk for SQLite, one app process/replica, and a host/volume
with encryption at rest. Do not put the database on an ephemeral filesystem or
shared network filesystem. Docker [service networking](https://docs.docker.com/compose/how-tos/networking/)
keeps internal service connections separate from published host ports.

Deployment requires a selected server/account, DNS name pointing to it and
permission to publish there. Alibaba Cloud is selected for future hosting; account payment setup is paused.
No server or paid plan has been provisioned.
On that host, with Docker Compose available:

1. Check out the reviewed release and run `npm run verify`.
2. Copy `deploy/staging/.env.example` to `deploy/staging/.env`. Set the DNS name
   and a new proxy token generated locally by `openssl rand -hex 32`. Keep the
   `.env` file private (`chmod 600 deploy/staging/.env`). Real values are ignored
   by Git and excluded from the image context.
3. Create tester access using the command above. The app runs as UID 1000 and
   must read the mounted hash file. Keep its parent directory private (0700);
   make the **hash-only** JSON file readable in the container, for example:

   ```bash
   chmod 700 deploy/staging/secrets
   chmod 644 deploy/staging/secrets/staging-testers.json
   ```

   Alternatively set file ownership to UID 1000 and retain mode 0600. Local
   [Compose secrets are file mounts](https://docs.docker.com/compose/how-tos/use-secrets/);
   do not assume Compose remaps host-file ownership. The tester CLI writes mode
   0600, so reapply the chosen permissions after each access-file update.
4. From `deploy/staging`, validate and start the selected deployment:

   ```bash
   docker compose build
   docker compose run --rm --no-deps app npm run config:check
   docker compose up -d
   docker compose ps
   docker compose exec -T app node scripts/healthcheck.mjs
   ```

5. Visit the configured HTTPS `/app`, pass the tester gate, register a separate
   administrator account, then grant it with:

   ```bash
   docker compose exec app npm run admin -- registered-test-email@example.test
   ```

   Sign in again and follow [driver onboarding](driver-onboarding.md) to submit
   fictional documents and record the review. Nothing creates default
   administrator passwords. Set up two independent browser profiles/devices.

Caddy can issue/renew certificates when DNS, public ports and persistent storage
are configured as described in its [automatic HTTPS guide](https://caddyserver.com/docs/automatic-https).
This has not been validated against a real domain for this project. The Compose
template is for direct edge deployment; do not disable TLS validation to make an
incorrect domain work. HSTS is limited to one day without includeSubDomains/preload.

The reference uses maintained major image tags. Resolve, record and pin tested
image digests before a hosted rollout, and review updates regularly. Docker
administrators can inspect runtime environment secrets. Avoid publishing expanded
`docker compose config`, environment dumps or proxy diagnostics. No image push
or cloud deployment runs in CI.

Maps default to off in staging. For a small manual preview, explicitly enable
`TAXI_AI_MAPS_MODE=community` and follow [the provider limits](locations.md).
Dedicated mapping capacity remains a production requirement. Calls default off;
set `TAXI_AI_CALLS_MODE=relay`, `TAXI_AI_TURN_URLS` and `TAXI_AI_TURN_SECRET` only
after provisioning the relay described in [voice](voice.md). Local WebRTC mode is
rejected in staging. No TURN service has been provisioned by this work.

## Backup and restore

From the repository root, with the source database selected by `TAXI_AI_DB`:

```bash
npm run backup -- /absolute/new-backup.sqlite
npm run restore -- /absolute/backup.sqlite /absolute/new-restored.sqlite
```

On the reference deployment, run inside the existing app container:

```bash
docker compose exec -T app npm run backup -- /backups/before-release.sqlite
docker compose exec -T app npm run restore -- /backups/before-release.sqlite /data/restored.sqlite
```

Both commands require new destination names and refuse existing files/sidecars.
The implementation uses SQLite [VACUUM INTO](https://www.sqlite.org/lang_vacuum.html)
for a consistent live snapshot, including committed WAL data. It checks schema,
integrity and foreign keys, sanitizes a private working copy, then publishes a
compacted, synced file with mode 0600. The original database is unchanged.
Incomplete/invalid copies are not published. A restore never overwrites the active
database. Only trusted snapshots matching this release's schema are accepted.

Saved accounts/password hashes, rides, agreed fares, pickup PINs, trip activity,
chat and consumed route history are preserved. Trusted contacts, frozen incident
locations, recipient names/numbers, notes and review/delivery history are also
retained; snapshots contain private data and are not anonymised or app-encrypted. Sessions, active call setup/locks,
shared live GPS positions/ownership and unused quotes are removed from the copy.
Pending Google attempts, email tokens and queued emails are also removed; verified
mailbox records are preserved. Restores cannot replay old account emails.
All active private trip links are revoked and both token/session hashes cleared.
Active calls are marked ended with `snapshot_reset`; active trips are retained for
operator review. Restoring repeats the cleanup, requires everyone to sign in and
does not resume calls/GPS or restore private-link access. An ordinary server restart still preserves valid
sessions and follows normal call/location lease expiry.

To activate a restored copy: stop **app** and **gateway**, set `TAXI_AI_DB_PATH`
to the new `/data/...sqlite` file in `.env`, recreate services and check health,
login, saved fare, chat and trip state. Keep the previous file until recovery is
confirmed. The restore point may precede later transactions; do not treat a
snapshot as a replay of subsequent activity. Do not use `docker compose down -v`
as a routine update; it deletes the named volumes.

Backups still contain sensitive saved records and need encrypted storage and
restricted operator access. Sanitization does not guarantee forensic erasure of
temporary files, host snapshots or storage media. A backup volume on the same
host does not protect against host loss. Once hosting is chosen, configure a
daily schedule, encrypted off-host copies, a retention period and an alert on
failure; these are not provisioned here. Perform a restore drill before inviting
testers, and take a new uniquely named backup before every schema/release change.

## Health, logs and shutdown

Internal `GET/HEAD /health/live` checks the running process; `/health/ready` checks
schema/database readability and shutdown state. Readiness is 503 while draining
or if the database cannot be queried. It does not prove disk capacity/writability,
map availability or working audio. Docker probes the app over loopback; the
gateway blocks public `/health/*`. Other direct or unauthenticated routes fail.

Application JSON logs include only event, timestamp, a generated request ID,
coarse route category, method, status and duration. They omit full URLs, IPs,
headers, bodies, credentials, GPS, chat, SDP and exception text. HTTP responses
include `X-Request-ID` for correlation. Unexpected request failures return generic
messages. The reference limits Docker log sizes. Review proxy/host logging
separately; the app cannot control platform diagnostics.

Monitor readiness, 5xx counts, `maintenance_failed`, failed backups, disk usage,
certificate expiry and unexpected restarts. No alert destination is configured.
SIGTERM/SIGINT marks readiness unavailable, stops maintenance and drains requests;
after 20 seconds remaining connections are closed. Compose allows 25 seconds.
This single-server setup has no high availability or zero-downtime release promise.

## Review and consolidation

The staging branch is based on the exact location milestone commit
`4a212b04537ab5b63c90b570f254e4df16e20a4f`. It includes the earlier foundation,
website, accounts, modular architecture, chat, trips, voice and location code.
PRs #1–#8 were still open drafts when reviewed. A consolidation PR against `main`
can bring this complete branch into the default branch in one reviewed change;
the original PRs remain available as feature-level history. After consolidation
is merged and checked on `main`, close remaining superseded PRs as appropriate.
Do not merge parallel alternatives blindly or reset a database to match old code.

Automated coverage includes a full routed journey through the staging HTTP
boundary, chat, call signaling, negotiated fare, booking/PIN, GPS, restart and
completion cleanup; it uses provider/media fixtures. Node CI checks supported
versions. Container CI validates the Caddy configuration and an isolated app's
gate, secure cookies, persistent restart, readiness and graceful exit. No browser
access workaround is used after the local-preview browser restriction.

Complete the outstanding manual review before treating the demo as ready for
testers or marking the consolidation ready to merge:

1. In local Chrome/Safari, walk the customer and driver journey, cancellation,
   stale offers, connection loss and re-login; check keyboard and 390/768/1440 px layouts.
2. On the selected HTTPS host, confirm unauthorized users cannot view HTML/assets
   or APIs, the app port is not reachable, account cookies are Secure and tester
   removal takes effect after app recreation. Run a restore drill.
3. Verify actual Nigerian address results/routes in multiple cities and public-provider limits. Test
   real in-area GPS, denied permission, stale fixes, Stop, logout and trip closure.
   GPS outside Nigeria is intentionally rejected; simulated locations
   do not establish physical-device accuracy.
4. With a provisioned relay, verify real two-way audio and microphone cleanup on
   Chrome/Safari and target phones/tablets across separate networks. Signaling
   tests are not proof of working audio. No native apps/background GPS are included.
5. Record results and failures in the PR. Keep test rides labelled and restrict
   access to invited testers. Verified onboarding, account recovery, dispatch,
   production safety operations, live payments and delivery workflows remain future work.

## Availability in the matching release

Matching introduced schema 6, payments schema 7, driver onboarding schema 8 and
Trip Safety schema 9, followed by [unified accounts](unified-accounts.md) at schema 10.
Preserve a backup with the matching previous release before upgrading. Current
backup commands require schema 10; restore older snapshots with their matching
release, then upgrade a separate copy. Onboarding snapshots retain private details,
document bytes and review history. They are not anonymised or encrypted by the app.
Availability positions and ownership are removed from snapshots.

Sample-area matching and new sample requests are local-only. Hosted staging
requires fresh Nigerian GPS and provider-backed route requests. With maps disabled,
users cannot create new routed requests; configure the provider for a hosted ride
test. Availability GPS does not enable map tiles or trip tracking automatically.
See [matching](matching.md) for controls, expiry and device review.

## Payments in private staging

Completed hosted test trips receive unpaid simulation records, but both payment
start and result simulation endpoints return 403 in staging. Existing simulation
records/receipts remain readable and clearly labelled. No Paystack keys, webhook
URL, hosted checkout or real payment processing are configured. Payment testing
for this milestone is local; see [payments](payments.md). Backups retain the
payment, attempt, receipt and retry records while clearing transient access and
location state. Future live data must be separated from these preview records.


## Trip Safety in private staging

Customers/drivers can create test SOS records, save fictional trusted contacts
and create expiring private trip links. Administrators can record acknowledgments
and closure. All notification records remain simulations; their state-changing
simulator endpoints are local-only and return 403 in staging, including replays.
No background worker sends notifications. See [Trip Safety](safety.md).

The invited-tester gateway remains required on `/trip-share` and its bearer-read
API. A recipient needs their own preview access as well as the private link.
No route bypasses the staging gate. Emergency operations, provider delivery,
verified contacts and response arrangements must be implemented separately.

## Native preview clients

Native v1 routes preserve the proxy/HTTPS boundary. Because Authorization carries
a device bearer token, invited-tester Basic access uses `X-Taxi-Ai-Preview-Access`
on `/api/mobile/v1/*` only. The existing Caddy reverse proxy passes this header;
no public bypass or extra backend port is introduced. Enter the tester credential
in the native sign-in screen, never in an Expo public environment variable. The
proxy token is never a client setting. See [the native contract](mobile-foundation.md).
