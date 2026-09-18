# Architecture direction

Start with a modular backend and shared business rules. Keep rides, food and
courier as separate modules where their workflows differ. Do not introduce
microservices solely to fill the directory structure.

## Hybrid AI approach

Use conventional, deterministic rules for authentication, permissions, fare
acceptance, booking state, dispatch commitments, payments and refunds. Predictive
models can suggest fares, ETAs and matches. Agentic components can later assist
with discovery, support and vendor tasks through narrowly authorized tools.

An assistant must not interpret a casual chat message as payment authorization
or independently settle a fare. Suggestions require explicit user actions where
they affect bookings or money.

## Current domain module

`FareNegotiation` is an in-memory model for a single customer/driver pair. It has
`open`, `agreed` and `cancelled` states. Every mutation needs an authorized
participant ID and the version the caller last saw. Each counteroffer gets a new
offer ID and version. Acceptance checks the offer ID, version, author and expiry.
The module returns copied snapshots so consumers cannot mutate internal state.

Amounts are positive safe integers in kobo. The suggestion is optional and
nonbinding. Offers default to a two-minute lifetime in this prototype; that is a
configurable demonstration policy, not a confirmed launch setting.

The `in_app`, `chat` and `voice_call` labels describe where a negotiation began.
They do not implement messaging, calling or transcription. Every channel uses
the same explicit `propose` and `accept` commands.

## Local persistence and authenticated commands

The website now serves a local account/ride API and separate customer, driver and
administrator dashboards. SQLite stores users, driver applications, sessions,
ride requests, fare events, idempotency keys and audit events. Migrations run at
startup; account data is excluded from Git. Passwords use salted scrypt; sessions
use random tokens with only their hashes stored in the database.

The server derives the actor from its session, checks ownership and driver
approval, and executes each ride mutation within a short database transaction.
Ride versions prevent stale changes; unique constraints and atomic claims prevent
two drivers from taking the same request. A per-user command key makes retries
idempotent. The fare model is reconstituted by replaying server-written commands,
never by trusting snapshots or timestamps sent by a browser.

Requests progress from `requested` to `negotiating` to `agreed`, or are cancelled
before agreement. A driver claim starts one exclusive conversation; it is not a
fare agreement or operational dispatch. Actual trip state is not implemented.
The UI polls every three seconds and restores saved state after refresh/restart.

See [the API notes](../services/api/README.md) for security boundaries, routes,
limits and migration considerations. The original homepage demonstration still
uses the in-memory module and does not create an authenticated request.

## Before this can back real bookings

- Add verified identity, account recovery and production authentication/session
  operations. Preserve session-derived actors and participant checks.
- Add genuine driver/document verification, eligibility and suspension workflows.
- Establish a production database, backup/restore and retention process. Preserve
  atomic version checks, event integrity, idempotency and one winning driver.
- Validate cross-process concurrency and scale for the chosen hosting setup.
- Keep expiry on trusted server time. Complete the operational booking/trip state
  machine; a fare agreement alone does not establish driver arrival or dispatch.
- Use payment-provider idempotency and webhook verification. Do not equate a
  successful client screen with settled payment.
- Extend local limits, validation and audit events with production monitoring,
  distributed abuse protection and an operational support process.

## Private communication

Choose an in-app internet voice provider or a WebRTC implementation when the
authenticated communication milestone begins. Issue short-lived room credentials
for the assigned participants and use application IDs as public identities.
Phone numbers must not appear in peer profiles, chat payloads or call-room IDs.
Provide report/block controls and an explicit consent design for any future
recording or transcription. Provider selection remains open.

## Client direction

The web clients use browser-native HTML/CSS/JavaScript and a same-origin Node
server without third-party runtime dependencies. The landing demo imports the
shared fare model directly; the authenticated dashboard sends commands to the
API, which owns state and applies those same domain rules. The sample quote
fixtures are not an AI estimator or live market prices.

The website and mobile clients should share domain contracts while adapting
their interfaces for web, iOS, Android and tablets. The vendor and administrator
areas require role-based permissions on the backend as well as in their UI.

The API will later orchestrate external maps, communication and payment
providers. No provider credentials or production integrations are included in
this repository yet.
