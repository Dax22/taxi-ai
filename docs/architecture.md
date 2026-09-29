# Taxi Ai architecture

Taxi Ai uses a **modular monolith**: separate business modules and explicit
dependencies share one application codebase and transactional storage. Local
development uses one combined process with SQLite. The PostgreSQL option runs
multiple HTTP replicas and separate coordinated workers against a shared database. The current code implements
accounts, driver review, ride/fare negotiation, trip lifecycle, participant chat
and audio calling, route quotes, driver location sharing, availability/nearby matching and simulated payments/receipts/earnings. Category-aware bookings use the shared
journey engine; a deliveries module owns parcel details and handover verification.
The Eats module owns restaurant menus, store membership, test checkout and food
fulfilment. It shares worker capacity with journeys through injected ports.
See [Eats architecture and acceptance](eats.md).
The guest-rides module owns immutable passenger details and revocable trip links;
the booking account retains fare, trip-management and payment authority.
See [booking for someone else](guest-rides.md).
See [scalability and deployment](scalability.md) for the PostgreSQL/PostGIS path,
worker roles, routing capacity and load-test limits. The implementation does not
establish capacity for one million users.
See [ADR 0001](decisions/0001-modular-monolith.md) for the decision and tradeoffs.

The target product is now one app and website with Customer, Drive & deliver
and My store modes. This is planned in [ADR 0002](decisions/0002-unified-app-and-multi-role-accounts.md)
and the [unified platform design](unified-platform.md). The account foundation
now implements Customer/Work on the website. [Schema 10](unified-accounts.md) adds
capabilities while preserving legacy identities, review evidence and sessions.

Google identity is now an optional module in release 0.19 (schema 14). The
account module owns external identity mappings and collision/linking rules;
`google-auth` owns expiring web/native challenges; the Google SDK remains behind
an infrastructure adapter. Web sessions and native credentials keep their
existing transports. See [Google authentication](google-sign-in.md) for module
responsibilities, configured activation, threat controls and acceptance limits.

Release 0.20 adds a separate `account-email` module (schema 15), shared by web
and native transports. It owns single-use actions and delivery scheduling; accounts
owns password changes, mailbox confirmation and session revocation. SMTP is an
infrastructure adapter. See [account emails](account-email.md) for retry, expiry,
recovery boundaries and remaining launch work.

Release 0.22 adds schema 16 vehicle categories and delivery handover state.
See [category workflows](vehicle-categories.md) for matching, quoting and migration
boundaries. Rides uses an injected deliveries port inside its existing transaction.

Release 0.23 adds schema 17 native device-bound availability and account updates.
The `notifications` module owns inbox events, opt-in device tokens and durable push
jobs; injected ride/chat ports create events inside the existing transaction, while
an Expo adapter sends generic alerts and checks receipts outside transactions.
See [native journeys](mobile-journeys.md) for ownership, retries and device gates.

## Implemented modules

Schema 18 adds `vehicle-checks`: consented, rider-owned photo analysis and temporary
comparison results. Image decoding and OpenAI vision are injected infrastructure
adapters; deterministic comparison rules use the approved journey snapshot.
An explicit safety report can attach the result through an injected evidence port.
See [vehicle photo checks](vehicle-photo-checks.md) for configuration and limits.

| Module | Responsibility | Owns |
| --- | --- | --- |
| Accounts | Registration, authentication, sessions, first-admin setup, own profile, driver enrollment and Work profile deletion | `users`, `sessions`, `account_capabilities`, `account_commands`, `account_identities`, `account_password_settings`, `account_email_verifications` |
| Account email | Verification and recovery actions, durable delivery intentions and bounded retries | `account_email_tokens`, `account_email_jobs` |
| Drivers | Private applications, documents, manual review and expiry eligibility | `drivers`, `driver_applications`, `driver_documents`, `driver_document_reads`, `driver_application_events`, `driver_application_commands` |
| Rides | Requests, fares, bookings, pickup verification, progress, cancellation and history | `rides`, `fare_events`, `idempotency`, `ride_trips`, `ride_activity` |
| Guest rides | Immutable guest passenger snapshots, booker-owned link management and limited public trip views | `guest_ride_passengers`, `guest_ride_links`, `guest_ride_commands` |
| Deliveries | Parcel validation, category/capacity eligibility and drop-off verification | `delivery_orders` |
| Eats | Store membership/review, dish search, menus, combined test checkout, kitchen and courier food handovers | `eats_stores`, `eats_memberships`, `eats_reviews`, `eats_menu`, `eats_quotes`, `eats_orders`, `eats_commands`, `eats_photos`, `eats_checkouts`, `eats_collection_points`, `eats_store_dispatch_points`, `eats_order_dispatch_points` |
| Notifications | Account-scoped inbox, device opt-in and durable push/receipt retries | `account_notifications`, `push_registrations`, `push_jobs` |
| Vehicle checks | Optional photo observations, comparison, retry reservation and expiry | `vehicle_photo_checks` |
| Chat | Participant messages, read markers, retries and reports | `chat_messages`, `chat_reads`, `chat_commands`, `chat_reports` |
| Calls | Audio invitations, session/window ownership, signaling, expiry and history | `voice_calls`, `voice_participants`, `voice_commands` |
| Locations | Provider-backed route quotes, fare suggestions, driver sharing and expiry | `location_quotes`, `location_quote_commands`, `location_shares`, `location_share_commands` |
| Availability | Driver Online/Offline, separate location consent, freshness and lease expiry | `driver_availability`, `availability_commands` |
| Payments | Completed-trip simulated payments, attempts, receipts and earnings summaries | `payments`, `payment_attempts`, `payment_receipts`, `payment_commands` |
| Shared domain | Pure fare state machine, lifecycle vocabulary, money, coordinate helpers and sample quotes | No storage or network |
| Dispatch | Timed invitations, bounded regional matching and matching metrics | `dispatch_offers`, `dispatch_commands`, `dispatch_journeys` |
| Realtime | Account-scoped change revisions and authenticated long polling | `account_revisions` |
| Worker coordination | Expiring leases and commit fencing for shared background jobs | `worker_leases` |
| Infrastructure | SQLite/PostgreSQL adapters, migrations, password hashing, random tokens, audit and rate limits | `audit_events`, `rate_limits`, connection lifecycle |
| HTTP | Route dispatch, request parsing, cookies, CSRF and error/status translation | No business state |

Every feature lives under `services/api/src/modules/<feature>/`:

- `service.mjs` implements use cases and authorization, receiving dependencies as
  factory arguments. It contains no SQL or HTTP objects.
- `repository.mjs` owns feature SQL and returns plain records. It participates in
  the caller's transaction and never commits independently.
- `routes.mjs` adapts HTTP inputs/results to an injected service. The shared router
  performs session, Origin/CSRF, body-size and rate-limit checks.
- `domain.mjs`, where useful, contains pure feature rules. The rides module uses
  it to check participants/versions and reconstruct the shared fare model.

`services/api/src/application.mjs` creates and connects services, repositories and
adapters. It is the only composition root. Business modules do not import one
another's internals. For example, rides receives a `getAccount(id)` port; account
registration receives driver-profile `find`/`insert` operations. The shared
transaction spans user and driver creation. Dependencies are plain functions and
objects, without a dependency-injection framework or service locator.

The runtime relationships are:

```mermaid
flowchart TD
  Web[Web dashboard] --> HTTP[HTTP adapters]
  HTTP --> Accounts[Accounts service]
  HTTP --> Drivers[Drivers service]
  HTTP --> Rides[Rides service]
  HTTP --> Chat[Chat service]
  HTTP --> Calls[Calls service]
  Accounts --> Repos[Injected repositories]
  Drivers --> Repos
  Rides --> Repos
  Rides --> Domain[Pure fare domain]
  Chat --> Repos
  Chat --> Rides
  Calls --> Repos
  Calls --> Accounts
  Calls --> Rides
  Repos --> DB["SQLite or PostgreSQL/PostGIS"]
```

Arrows represent calls, not permission to import an implementation. The
composition root supplies dependencies. Authentication is session based; passing
a user ID from the browser never grants access to that user's account or ride.

## Commands, persistence and consistency

Requests progress from `requested` to `negotiating` to `agreed`. The customer then
confirms a booking. Its driver records on-way/arrival, starts with the pickup PIN
and completes the trip. Pre-start cancellation preserves any agreed fare.
See [the trip contract](trips.md) for availability, transitions and PIN handling.
These are test journeys; the homepage demo remains an independent in-memory example.

For each authenticated ride mutation, the service:

1. Validates the command key and begins an awaited database unit of work.
2. Reloads the actor, checks a previous key's command fingerprint, or validates
   permissions and the current ride version.
3. Applies the command using server time and the pure fare rules.
4. Writes the ride, fare event when applicable, audit event and retry key together.
5. Returns a projection only after the transaction succeeds. Persistence failures
   roll back all these writes. Incorrect PIN submissions instead commit their
   failure counter, audit reference and failed-command key before returning a
   validation error; retrying one cannot count as a second guess.

The SQLite adapter uses `BEGIN IMMEDIATE`, foreign keys and unique constraints for
one open request per customer, one active negotiation per driver and one active
trip per participant. Service checks also prevent mixing an active trip with a
new request/negotiation under the same transaction. A replayed
key returns the current saved ride; a different command with that key is rejected.
Rate-limit counters are intentionally a separate transaction so failed attempts
still count. Expensive password work runs outside transactions.

Repository operations and `unitOfWork(callback)` are asynchronous contracts.
The local SQLite adapter serializes access to its connection for the whole
transaction, including awaited calls. PostgreSQL pins a pooled connection to a
serializable transaction and retries serialization/deadlock failures within a
bounded budget. Nested units use savepoints. Every business write must be awaited;
external routing, mail and other provider I/O stays outside the transaction.
Foreign keys, unique constraints and version checks remain database-enforced.
See [scalability](scalability.md) for pool sizing and operational verification.

The existing `data/taxi-ai.sqlite` location is preserved. Ordered SQLite
migrations preserve accounts, fares and journeys; the current schema includes
realtime revisions, indexed locations and worker regions/leases through migration
30. PostgreSQL has its own migrations, including PostGIS indexes, applied with
`npm run db:postgres:migrate` before application startup. Setting a PostgreSQL URL
does not copy an existing SQLite database; follow [PostgreSQL migration and recovery](postgresql.md).
Older SQLite binaries refuse a newer
schema. Local data and secrets are excluded from Git and static serving.
See [API notes](../services/api/README.md) for routes and current security limits.

## Fare rules

`packages/shared/src/fare-negotiation.mjs` models one customer/driver pair in
`open`, `agreed` or `cancelled` state. Every mutation checks the participant and
expected version. Every counteroffer has a new offer ID. Acceptance requires the
current offer ID/version, an unexpired offer and the other person's explicit
consent. Returned snapshots are copies, not mutable internal state.

Amounts are positive safe integer kobo. Suggestions are nonbinding; sample quotes
are fictional. Route quotes use an explicit illustrative formula, not an AI
estimator or a validated local market rate. Server-persisted events reconstruct the fare
model; clients cannot upload snapshots or set event clocks. Ride versions also
include claiming/cancelling before a fare conversation; fare-event versions track
only the shared model. Their distinct sequences are validated separately.

The domain's `in_app`, `chat` and `voice_call` labels describe where an offer began;
they do not themselves implement communication. The current chat presents fare
cards and calls the same in-app offer/accept endpoints. Free text never changes
the fare. Voice calls also leave fares unchanged; both people must use the
existing offer/accept controls after discussing a price.

## Web and future mobile clients

The website uses native HTML/CSS/JavaScript. `apps/web/server.mjs` composes the
application/router and serves an explicit static allowlist. It defaults to loopback;
staging uses an authenticated HTTPS gateway and one configured origin.
At `/app`, `dashboard.mjs` wires DOM and feature adapters. The injected page
controller coordinates session state, dashboard reads and actions:

| Client module | Responsibility |
| --- | --- |
| `dashboard/api-client.mjs` | Same-origin requests, CSRF, timeout and stable retry keys |
| `dashboard/page-controller.mjs` | Account/session boundaries, coherent dashboard refreshes and queued-action guards |
| `dashboard/auth-form.mjs` | Login/registration form state and input collection |
| `dashboard/views.mjs` | Role-specific rendering and user action callbacks |
| `dashboard/conversation-controller.mjs` | Chat pagination, selected-account isolation and read acknowledgement |
| `dashboard/conversation-view.mjs` | Plain-text transcript, fare cards, drafts and reporting form |
| `dashboard/conversation-model.mjs` | Pure timeline and offer-card presentation rules |
| `dashboard/chat-reports-view.mjs` | Administrator view of reported messages |
| `dashboard/call-controller.mjs` | Call polling, explicit microphone consent, session isolation and cleanup |
| `dashboard/call-media.mjs` | Browser WebRTC, audio tracks and bounded ICE gathering |
| `dashboard/call-view.mjs` | Call controls, audio playback and recent call history |
| `dashboard/location-planner.mjs` | Explicit online consent, manual search, selected points and saved route quotes |
| `dashboard/location-sharing.mjs` | Driver GPS lifecycle, session/window isolation and bounded updates |
| `dashboard/availability-controller.mjs` | Separate availability consent, GPS/sample updates and lifecycle |
| `dashboard/availability-view.mjs` | Online/Offline and local sample-area controls |
| `dashboard/geolocation.mjs` | Browser permission and device location adapter |
| `dashboard/location-view.mjs` | Route forms, fare details and sharing controls |
| `dashboard/map-view.mjs` | Visible raster tiles, SVG routes/pins and keyboard map interaction |
| `dashboard/payments-controller.mjs` | Isolated payment/receipt requests and paged driver/admin records |
| `dashboard/payments-view.mjs` | Simulation controls, printable receipts and exact totals |
| `dashboard/account-mode-view.mjs` | Per-window Customer/Work navigation, enrollment and active-journey return paths |
| `dashboard/dom.mjs` | Small DOM helpers using text content |

Views do not call `fetch`. The client retains the displayed offer ID/version and
refreshes on a conflict; it never automatically accepts a new price. Dashboards
poll every three seconds while visible. Browser rendering/accessibility checks
remain a separate manual review, documented in the web README.

Account, role or session-token changes synchronously reset private views and
feature controllers before later reads. Parallel dashboard data is published only
after a second session check. Queued actions cannot run under a replacement
session; responses from an earlier API-client generation cannot update the clock
or erase current retry keys. See [journey verification](pilot-readiness.md).

One native Taxi Ai app for iOS/Android, including tablets, lives in `apps/mobile/`
using React Native + Expo + TypeScript. The website/backend remain JavaScript ESM.
Customer/Work modes share account use cases and versioned API contracts. Eats
and My store are separate native screens using the same authenticated account. Device sessions, secure credential storage and
expiry/revocation are implemented separately from browser cookies. Native views
and device adapters remain platform-aware. Schema 19 implements one owner membership per store/account in the Eats module.
Schema 20 adds home-kitchen defaults and normalized photos; batch reservations,
order transitions and command records commit atomically. Image decoding is an
injected infrastructure port outside the transaction, with session revalidation
before saving. Private vendor and home-kitchen addresses are projected by participant and order stage.
Schema 21 adds combined checkout and order-specific collection points. Vendor and
home-kitchen profiles now use only a town/area; private collection details are supplied when
food is ready. Dish search checks delivery coverage against published menus, and
combined checkout commits every kitchen's order and stock reservation together.
Schema 22 adds guest passenger snapshots and session-bound guest links without
changing existing ride ownership. A missing passenger snapshot means a self booking.
The shared link controller preserves exact retries and holds raw secrets only in
memory; public link reads return a separate allowlisted trip projection. Completion,
cancellation, replacement, revocation and session expiry end access. Snapshot copies
clear guest-link secrets and active state along with other transient capabilities.
Schema 23 adds private store pickup locations and immutable order dispatch points.
Nigeria-wide country validation and canonical state/town identifiers live in pure
shared modules. The Eats service enforces declared delivery areas and nearby GPS
courier matching; a change in national scope never grants an old store nationwide
coverage. Existing sample IDs remain readable. See [nationwide coverage](nationwide.md).
Mode selection remains per client; authorization, ownership and worker capacity
remain server-side. Workspace resets and retry keys are now scoped to account
and Customer/Work mode. Calls/GPS/availability use a separate session client and
preserve active trip ownership across mode changes. The shared Eats controller resets private state on account changes,
preserves exact retries and checks store/order permissions server-side. See the
[unified plan](unified-platform.md) for active-work continuity and acceptance cases.

## Participant chat

Chat receives account and narrow ride-membership/status ports through the
composition root, so chat polling does not replay fare history. Its
repository owns only chat tables. Send commands recheck participants inside a
transaction and commit the message, audit reference and retry key together. Read
markers advance monotonically. The dashboard discards delayed responses after
changing rides or accounts and keeps unsent drafts in memory per conversation.

The chat transcript projects fare cards from ride state; it does not duplicate
price decisions in chat storage. Administrators can review explicitly reported
messages through dedicated endpoints, without access to full conversations.
See [the chat guide](chat.md) for the API contract and development limits.

## Participant audio calls

The calls service receives account/session lookup, ride membership and a relay
configuration adapter through composition. It owns its SQL tables and changes no
fare records. The rides service receives an `onRideClosed` port that clears live
call state within the trip completion/cancellation transaction. This callback
does not start a nested transaction or call back into the rides service.

One transaction reserves both participants, binds the caller's session/window and
saves the command/audit reference. Answering binds the recipient's session/window.
Only those two windows can read or submit audio setup. Any authenticated participant
can hang up, including from a replacement window. Expiry also checks revoked
sessions and call configuration changes, and releases reservations and temporary
SDP. Metadata history survives restart; media never lives in the database.

The browser adapter uses WebRTC audio with a single offer/answer and fully gathered
ICE candidates. HTTP polling supplies signaling only; browser peers or the TURN
relay carry audio. `call-config.mjs` defaults to local testing without external
ICE services. Relay mode creates short-lived coturn credentials, and requires relay
candidates. No TURN service is provisioned. See [the voice contract](voice.md).

## Route quotes and driver locations

The location service receives account/session and narrow ride-context ports.
`infrastructure/map-provider.mjs` encapsulates Photon/OSRM HTTP, configured hosts,
timeouts, response caps, caching and per-provider request pacing. The domain
validates bounded points, route geometry/distance/time and computes integer-kobo
suggestions. No browser-supplied distance or fare can become a route quote.
Search uses the Nigeria country filter and search extent; shared polygon validation
guards coordinates independently of the provider. Local matching radii remain
unchanged when routes and GPS are accepted elsewhere in Nigeria.

External I/O runs outside database transactions. Quote creation then
rechecks the live session, role, retry fingerprint and per-user limit inside the
transaction. Rides receives `quoteForRide`, `bindQuote` and `routeForRide` ports;
insertion, quote consumption, audit and retry key commit together. This creates
one ride from one nonexpired customer-owned quote, without cross-module SQL.

GPS sharing binds the assigned driver's session and browser-window hashes.
Only the newest sequence can advance a position; device-reported age, accuracy
and bounds are validated, but do not establish physical presence. Any current
window of that approved driver can stop the share. Stopping clears the latest
coordinate and ownership hashes; there is no breadcrumb-history table. The
existing `onRideClosed` callback closes calls and location sharing in the trip
transaction. It never opens a nested transaction or calls back into rides.

Server cleanup checks trip state, driver approval, session expiry and a 60-second
write lease. Clients discard delayed responses after account/journey changes and
never resume GPS automatically. Public tiles require an explicit map opt-in,
independent of GPS consent. See [locations](locations.md) for privacy, retention,
configuration and the remaining provider/browser/device validation.

## Adding planned features

| Future module | Boundary to preserve |
| --- | --- |
| Production communication | Operated TURN infrastructure, cross-network/mobile validation, push notifications and abuse controls |
| Taxi Ai Eats production | Payments/settlements, merchant verification, operational support, notifications and live courier tracking; test ordering is implemented |
| Courier | Parcel details, vehicle eligibility and proof of delivery; confirm its pricing policy separately |
| Live payments | Provider checkout/verification, authenticated webhooks, durable reconciliation, refunds and payouts |
| AI assistance | Fare/ETA suggestions and authorized assistance through explicit application commands |

Create modules when implementing these workflows, without empty service shells.
Motorcycles belong to food/small-parcel delivery; passenger rides use cars. Larger
courier jobs can use suitable cars/vans. Autonomous taxis remain **Coming soon**;
the site does not imply an operational fleet or a launch date.

Provision and validate a relay before a public calling pilot. Keep application IDs
in peer payloads, add report/block controls and require an explicit consent design
for any future recording/transcription. The TURN shared secret remains in the
server adapter. AI may assist discovery/support; it must not independently
accept fares, authorize charges or change safety permissions.

## Enforced conventions and deployment limits

`runtime-config.mjs` validates deployment mode, canonical origin, persistent path,
gateway token and tester-key hashes before startup. HTTP enforces the gateway
and tester boundary before routing; business authorization still uses account
sessions. Staging cookies use the `__Host-` prefix, Secure, HttpOnly and
SameSite=Strict, without Domain. Local cookies are never accepted in staging.
Staging keeps the same business schema and authorization rules as local development.

`health.mjs` checks database/schema readability and shutdown state. Telemetry
records only generated request IDs, coarse categories, method, status and timing;
it receives no customer bodies or error objects. The server drains requests for
up to 20 seconds before closing remaining connections. Operations do not live in
ride/fare services.

`database-snapshot.mjs` is an operator-only infrastructure adapter. It uses a
consistent SQLite snapshot, clears transient authentication/communication/location
state in the copy, validates integrity/foreign keys and atomically publishes to
a new filename. It cannot overwrite a destination. Restoring repeats validation
and sanitization and requires an explicit database-path switch while the app is
stopped. This snapshot command is specific to SQLite. PostgreSQL needs its own
protected backups and tested restore procedure; it is not backed up by copying a
SQLite file. The SQLite staging template keeps one app process and local volume.
The scale template uses two HTTP replicas, separate workers and PostgreSQL behind
an HTTPS gateway. It remains a single-host example, not a highly available cluster.
See [staging](staging.md) and [scalability](scalability.md) for recovery, deployment
boundaries and required live checks.

`npm run check` checks syntax, missing imports, dependency direction, cycles and
our SQL/network placement conventions. It assumes static ESM imports and uses a
small convention checker, not a complete JavaScript parser or a security sandbox.
`npm run verify` adds domain, API client, HTTP and persistence tests. GitHub Actions
runs the same command on Node 22.12.0 and Node 24 for pushes and pull requests.

A modular structure is a maintainability foundation, not production readiness.
Before real bookings, implement verified onboarding/account recovery,
production session operations, operated encrypted off-host backups and retention, deployment
monitoring and measured concurrency/scale. Timed dispatch is implemented for test
journeys; production trip safety operations, operated mapping and payments remain
additional product milestones. Current
administrator approval records manual review evidence and gates new test rides; it does not contact identity/licence providers.

## Driver availability and request matching

Availability owns its location leases and retry keys. Rides receives a narrow
`positionFor` port for eligibility and `onClaim` for atomic availability cleanup.
Availability receives account/session lookup and a workload port. Neither module
imports the other's implementation. These callbacks join the caller's transaction.

Rides owns request deadlines and radius expansion. Unclaimed expiry is a distinct
API projection over a cancelled storage record, with an explicit closure reason.
It is committed before a rejected late command; successful claims instead commit
the request, availability closure, audit and retry key together.

Timed dispatch partitions requests into 0.05-degree pickup cells; driver searches
cross cell borders using the pickup radius. PostgreSQL uses a PostGIS index and
SQLite uses coordinate bounds, followed by the shared distance and eligibility
checks. Each cycle has bounded ride/driver pages with continuation cursors so
exhausted early candidates do not permanently hide later candidates. Pending
offers are excluded across regions and global unique indexes prevent competing
workers from issuing two active offers to the same driver or request.

Road ETA queries run outside transactions. Before writing offers, workers check
lease ownership, ride versions, current location, approval, availability and
workload again. Fare acceptance and booking confirmation remain explicit.
Ordinary availability, trip-location and ride requests validate only their own
state; workers handle indexed expiry and rotating maintenance pages. The legacy
request-list mode remains available for local compatibility testing.
See [matching](matching.md), [realtime updates](realtime-updates.md) and
[scalability](scalability.md) for consent, privacy, lifecycle and measurement limits.

## Simulated payments

Rides receives `onTripCompleted` and payments receives a participant-checked
`paymentContext` through composition. Completion inserts an unpaid record using
the immutable booking fare in the same transaction; no callback opens a nested
transaction. A separate payment version protects attempts without changing fares.
Payment, attempt, receipt, audit and command-key writes commit atomically.

The only provider is a pure synchronous local simulator, with no external I/O.
Its result is checked against the current reference, amount, currency and mode.
A future external adapter must perform I/O outside transactions and add durable
verified reconciliation. No customer-controlled simulation endpoint can become a
live payment endpoint. Aggregate kobo totals use BigInt internally and decimal
strings in JSON; individual fares remain safe integers. See [payments](payments.md).


## Driver onboarding and document privacy

The [onboarding guide](driver-onboarding.md) describes the state machine, private
API, review evidence and schema-eight upgrade. The drivers service receives a
byte codec, clock, IDs/hashing, account lookup and a narrow unfinished-work query.
Its repository alone owns application/document/read/event/command SQL. All writes,
including an approval's evidence and public vehicle projection, share one transaction.

Accounts registration creates both the driver row and draft application. The
account profile receives eligibility through an injected driver-service port;
that port reads application metadata without calling accounts again. Private
contact/licence fields and document bytes never enter the public driver profile.
Availability and rides enforce current eligibility through account projections.
Already-started trip completion retains the prior approval policy. Rides snapshots
only public driver identity/vehicle data at assignment, including migration backfill.

`onboarding-controller.mjs` owns private requests, account/selection generations
and pending actions. `onboarding-view.mjs` owns form drafts and exact displayed
versions. `driver-files.mjs` owns bounded browser file reads/downloads. The page
controller resets onboarding with the other account-bound features. No document
content is stored in localStorage, URLs, static files or logs. Downloads and file
reads arriving after a reset are ignored. Backups retain private documents and
must receive the same access controls as the database.


## Trip Safety

`modules/safety/` separates pure validation/state transitions, SQL, service rules
and route adapters. Composition injects readonly account, participant trip,
current shared-location and session-owner ports. Incident creation snapshots those
ports within one awaited transaction; it does not reach into another module's
repository or open a nested transaction. Notifications are durable simulated rows,
not external side effects. Contact removal and administrator closure cancel queued
work in the same transaction. Trip closure revokes links through a narrow callback
but never marks an incident resolved.

Account routes enforce reporter/owner/admin access; the peer in a trip cannot read
the other's report. The isolated bearer-read route accepts only a token and returns
a minimal trip projection. Token and owner session hashes, exact expiry and current
trip status are checked server-side. Retried link creation cannot recover a raw
secret. Replacement requires the current link ID. Backups revoke every active link
and retain private incident evidence. See [the safety contract](safety.md).

`safety-controller.mjs` isolates account/trip/admin selection generations, pending
commands, private DTO viewer IDs and in-memory link secrets. `safety-view.mjs` owns
form drafts, exact displayed review versions and text-only rendering. The separate
trip-share controller clears details on hidden pages, errors and link expiry.
All browser requests use the existing API client. No AI agent or notification
provider operates on these records in this milestone.

## Native customer booking

Release 0.21 / mobile 0.5 connects a protected booking screen to existing location
and ride services through `http/mobile-booking.mjs`. It adds no persistence or
second booking engine. Planning alone can validate native sessions through the
injected device-access owner port; live location-sharing authorization stays
unchanged. Controller, typed wire readers, API transport and native views remain
separate. No provider SDK or database access reaches the app. See
[booking contracts and recovery](mobile-booking.md).

## Native foundation and future staff application

Release 0.15 adds `modules/device-sessions` and a separate `/api/mobile/v1` bearer
router. The composition root injects account verification/profile and revocation
ports; services retain their transaction boundaries. Web cookies keep their CSRF
contract. Wire readers/types belong to `packages/shared/src/mobile-contracts.*`.
Native UI, secure storage and transport are separate in `apps/mobile`; backend
imports are forbidden by `scripts/check-mobile.mjs`. Native dependencies install
independently, with their own lockfile and CI job.

Schema 11 adds device families and hashed token history. Snapshots clear both.
See [native auth/API](mobile-foundation.md) and [the separate staff dashboard
design](admin-dashboard.md).

## Operations reporting application

Release 0.18 implements `apps/admin/public` with its own transport, session/page
controller, route model, components and charts. Static routes are allowlisted in
the existing server and packaged in the staging image. `modules/admin-console`
owns a read projection over explicit account, trip, vehicle and payment fields;
the composition root injects its repository, audit adapter, transaction and clock.
No frontend imports database code and no reporting service mutates business state.
Schema 13 adds reporting indexes without data backfill or record changes.

Staff role checks are applied both at HTTP and service boundaries. Audited detail
views, bounded filters, stable pagination and exact kobo sums are shared across
the pages. The application uses existing web cookies on the same origin;
dedicated staff sessions/origin remain deployment work.

`staff-access` owns separate staff membership, permissions, encrypted TOTP factors
and session-bound verification. `admin-operations` owns bounded queue projections.
`admin-cases` owns support/safety workflow and receives narrow evidence and source
incident synchronization ports from the composition root. Privileged HTTP writes
recheck the current session and permission inside the mutation transaction.
SQLite migrations 33–35 and PostgreSQL migrations 5–7 add these tables and indexes,
derive Owner memberships from existing administrators and backfill saved SOS cases.
See [setup and module map](../apps/admin/README.md) and
[roles and workflow](admin-workspace.md).

`admin-finance` provides read-only simulated payment projections, exact kobo totals
and local record checks. `admin-demand` aggregates historical request cohorts and
separately captures current eligible driver supply. Neither mutates payments or
matching. `admin-compliance` projects document status through the canonical driver
eligibility port and owns internal follow-up tasks, events and idempotency records
(SQLite migration 36, PostgreSQL migration 8). It cannot approve drivers or send
notifications. All three use scoped staff permissions; see the
[finance, compliance and demand guide](admin-finance-compliance-demand.md).

The same `admin-demand` module also owns `/api/admin/console/demand/coverage`.
Its SQL projection groups saved pickup points and current eligible supply into
bounded geographic cells, without returning raw locations. The staff map has
separate projection/navigation and rendering modules, backed by bundled country
geometry and sourced city navigation anchors. Historical requests and measured
pickup waits remain separate from current waiting requests and driver supply;
see [nationwide coverage](nationwide-coverage-map.md).
