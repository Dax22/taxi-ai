# Local accounts and ride API

`npm run dev` starts one Node process serving the website and `/api` on loopback.
It uses `node:sqlite` with explicit schema migrations and no third-party runtime
dependencies. This milestone is a local prototype, not a production auth service
or transport dispatch system.

## Code boundaries

`src/application.mjs` wires the accounts, drivers, rides and chat modules. Each module
contains a service, repository and route factory; rides also has pure domain
helpers. Services receive repositories, clock and cross-module operations as
explicit dependencies. They do not import HTTP or database adapters. Repositories
own their tables and participate in the service's unit of work.

`src/http/` handles transport and error/status translation. `src/infrastructure/`
implements SQLite, password/token operations, audit and rate limits. `src/shared/`
contains small common errors, validation and authorization policies. See
[the architecture](../../docs/architecture.md) for ownership and transaction contracts.

Ordered migrations add chat and trip tables, bringing the schema to version 3.
The `data/taxi-ai.sqlite` location, existing test accounts, sessions and rides are
preserved. No reset is required. Earlier code refuses the upgraded file; use a separate database when comparing branches.

## Implemented boundaries

- Passwords: salted scrypt (`N=32768, r=8, p=3`), 12–128 characters, timing-safe
  comparison and at most two concurrent password jobs. Passwords are never
  returned or logged. Parameters follow an alternative documented in the
  [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- Sessions: random 256-bit tokens, SHA-256 token hashes in the database, 12-hour
  expiry, rotation at login and server-side logout. The browser receives an
  HttpOnly, SameSite=Strict cookie; no auth tokens go into local storage.
- CSRF: exact loopback Host/Origin checks, JSON writes and a session-bound CSRF
  header for authenticated mutations. Login/registration also require Origin.
- Authorization: actors and roles come from the session/database. Only an approved
  driver can claim; only the customer and assigned driver can negotiate or read
  a request. Unknown and unrelated request IDs both return 404.
- Privacy: available requests show sample areas and a fare suggestion only.
  Assigned peers see name and, for the driver, car/plate details. Peer payloads
  contain no email, phone number, password or session information.
- Limits: 16 KiB JSON bodies; 30 authentication attempts per source IP per ten
  minutes; 60 authenticated writes per user per minute. Counters survive restart.
  One open customer request, one driver negotiation and at most 100 fare offers
  per request. Lists show the latest 50 own rides, first 50 available requests
  and up to 100 driver applications. This is not a production anti-abuse system.
- Persistence: SQLite foreign keys, CHECK/unique constraints, WAL, full synchronous
  durability and short `BEGIN IMMEDIATE` write transactions. Database schema version
  is checked on startup; a newer unsupported schema is rejected.

The SQLite API requires `--experimental-sqlite` on Node 22.12; npm scripts include
it. See [the Node 22.12 documentation](https://nodejs.org/download/release/v22.12.0/docs/api/sqlite.html).

## Request and fare state

`requested → negotiating → agreed` remains the fare flow. Customer confirmation
creates a booked trip, followed by driver departure, arrival, PIN-verified start
and completion. Cancellation is allowed before starting; an agreed fare remains
immutable even after cancellation. Actual dispatch and payment remain planned.
See [the trip contract](../../docs/trips.md) for transitions, PIN privacy/limits,
idempotent failed guesses, cancellation and cursor-based history.

The first approved driver to claim gets the only negotiation slot. Claiming does
not agree a fare. Offers begin after the driver is assigned; either person can
propose. There is no multi-driver bidding pool in this milestone. An agreement
records explicit acceptance of the current, unexpired offer by the other person.

Fare commands are persisted as a server-only event log and replayed through
`FareNegotiation`. API clients cannot upload state snapshots or set actor IDs,
clocks, offer lifetimes, channels, approval flags or agreed amounts. Ride versions
include claim/cancel transitions; domain-event versions track only fare commands.
Every mutation checks the submitted ride version inside its database transaction.

Ride mutation requests require an `Idempotency-Key` header (16–128 letters,
digits, dashes or underscores). Each key belongs to the authenticated actor and a
canonical command fingerprint. The command, fare event, audit row and key commit
together. Replaying the same command returns the current saved ride; reusing the
key with another command returns 409. The web client retains keys after network
errors during that page session. A refresh loses in-memory keys, but the dashboard
reloads persisted requests; the one-open-request and version rules still apply.

The browser polls every three seconds and uses server time to display expiry.
The server decides whether the offer is still valid. Stale acceptances return 409;
the client refreshes without automatically accepting a replacement price.

## HTTP routes

| Method and path | Access / purpose |
| --- | --- |
| `POST /api/auth/register` | Same-origin; customer or driver only |
| `POST /api/auth/login` | Same-origin; creates a rotated session |
| `GET /api/session` | Own profile + CSRF token, or null when signed out |
| `POST /api/auth/logout` | Session + CSRF; revokes the current session |
| `GET /api/rides` | Own requests; approved drivers also see open requests |
| `POST /api/rides` | Customer; `{ pickupId, destinationId }` |
| `GET /api/rides/:id` | Assigned participants only |
| `POST /api/rides/:id/claim` | Approved driver; `{ expectedVersion }` |
| `POST /api/rides/:id/offers` | Participant; `{ expectedVersion, amountKobo }` |
| `POST /api/rides/:id/accept` | Other participant; `{ expectedVersion, offerId }` |
| `POST /api/rides/:id/cancel` | Participant before start; `{ expectedVersion, reason? }` |
| `POST /api/rides/:id/confirm` | Customer; `{ expectedVersion }` |
| `POST /api/rides/:id/depart`, `/arrive`, `/complete` | Assigned approved driver; `{ expectedVersion }` |
| `POST /api/rides/:id/start` | Assigned approved driver; `{ expectedVersion, pickupPin }` |
| `GET /api/rides/history?before=:id` | Own completed/cancelled journeys, 20 per page |
| `GET /api/admin/drivers` | Administrator only |
| `POST /api/admin/drivers/:id/review` | Administrator; `{ decision }` approved or rejected |

All ride writes need session + CSRF + idempotency key. JSON errors contain a stable
`error.code` and readable `error.message`; internal details are not returned.

Register a dedicated customer account and run `npm run admin -- registered-email`
to bootstrap the first administrator locally. This command revokes that account's
sessions, refuses an account with ride history and refuses if an admin exists.
Driver review supports pending → approved/rejected. There is no document upload,
licence check, resubmission, suspension or appeals workflow yet.

## Participant chat

The chat module uses account and ride service ports injected at composition. Only
the assigned participants can open a thread. Sends validate plain text, generate
server identities/times, and commit the message, audit and retry key together.
Messages are capped at 500 per ride and paged in batches of 100. Monotonic read
cursors track each participant separately. Message text cannot mutate a fare.

Reported messages are visible in a dedicated administrator queue; administrators
cannot use chat routes to read unreported conversation content. This is a local
moderation preview, not a staffed safety service or end-to-end encrypted chat.
See [the chat contract](../../docs/chat.md) for routes, lifecycle and limitations.

## Before public hosting or a real pilot

Select a production authentication approach with email/phone verification,
account recovery and appropriate MFA. Add HTTPS with Secure cookies, reviewed
host/proxy configuration, distributed abuse protection, session management,
monitoring, database backup/restore, retention/deletion and operational access
controls. Review credential security and obtain independent security testing.

Choose the production database/hosting setup (PostgreSQL remains a candidate) and
validate cross-process transactions and scale before moving beyond local testing.
SQLite's synchronous API is intentionally bounded here; it is not a commitment to
the eventual multi-instance deployment architecture.

Add verified driver/vehicle onboarding, maps, matching/reassignment, operational
trip recovery/safety operations, communication and payment-provider integrations before
accepting live bookings. No provider keys or live integrations are present.

## Validation

`npm run verify` checks module boundaries and runs the shared rules, client and
HTTP integration tests, including competing
claims, duplicate requests/acceptance, role and record isolation, CSRF/Origin/Host
checks, offer expiry, cancellation, session revocation and full server/database
restart. Tests use isolated memory databases or disposable temporary files and
never read the developer's account database. A fault-injection test fails the
final retry-key write and verifies that fare, ride and audit changes all roll back
and the same command can safely be retried. Transaction tests reject asynchronous
callbacks. GitHub Actions runs verification on Node 22.12.0 and Node 24.

Chat tests also cover participant isolation, duplicate sends, atomic rollback,
pagination, unread cursors, report access/review, restart persistence and the
version-one database upgrade. Controller tests check stale responses across rides
and accounts, hidden/unread behaviour, drafts after failed sends and interrupted
pagination. Full browser interaction remains a manual review requirement.
