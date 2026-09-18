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

## Before this can back real bookings

- Authenticate requests on the server. Derive the actor ID from the session;
  never trust an actor ID, role or price state supplied by a client.
- Verify participant membership, driver eligibility and request ownership.
- Persist state and an audit log. In a database transaction, update only when
  the stored version equals the submitted expected version. The current class
  detects stale changes on one instance; it is not a distributed lock or a
  persistence layer.
- Use server time for offer expiry. Client-controlled clocks are not authoritative.
- Make booking creation idempotent and ensure only one driver can win a request,
  even if several negotiations are open. A fare agreement is one prerequisite
  for booking, not the complete booking state machine.
- Use payment-provider idempotency and webhook verification. Do not equate a
  successful client screen with settled payment.
- Add rate limits, scoped access, validation, structured audit events and an
  operational support process at the API boundary.

## Private communication

Choose an in-app internet voice provider or a WebRTC implementation when the
authenticated communication milestone begins. Issue short-lived room credentials
for the assigned participants and use application IDs as public identities.
Phone numbers must not appear in peer profiles, chat payloads or call-room IDs.
Provide report/block controls and an explicit consent design for any future
recording or transcription. Provider selection remains open.

## Client direction

The website and mobile clients should share domain contracts while adapting
their interfaces for web, iOS, Android and tablets. The vendor and administrator
areas require role-based permissions on the backend as well as in their UI.

The planned API will orchestrate external maps, communication and payment
providers. No provider credentials or production integrations are included in
this repository yet.
