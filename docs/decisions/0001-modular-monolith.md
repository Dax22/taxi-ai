# ADR 0001: Modular monolith for the first Abuja release

Status: accepted for the development prototype.

## Context

Taxi Ai needs customer accounts, driver onboarding, rides and explicit fare
negotiation now. Eats, courier, private communication and mobile clients will add
different workflows. The current project runs locally on Node 22.12+ and has no
operating team or traffic evidence that would justify separate backend services.

## Decision

Keep one backend process and one database, with accounts, drivers and rides as
business modules. Each module exposes application services, owns its repository
and supplies HTTP route adapters. Services receive dependencies through factory
arguments; `services/api/src/application.mjs` is the composition root. Modules do
not import each other's repositories or services. Share only genuinely common
domain rules, validation and authorization policies.

Use native JavaScript ESM for this iteration, preserving the existing Node/VS Code
workflow. Validate syntax, imports, dependency direction, cycles and behaviour in
one `npm run verify` command and in GitHub Actions. The boundary checker enforces
our static-import conventions; it is not a type checker or a security sandbox.

Keep synchronous SQLite transactions around each ride command, including its
fare event, audit entry and idempotency key. Preserve the existing schema and
database location. No developer data migration or reset is required by this
refactor.

## Consequences

- Features can be developed and reviewed in their own modules while deployment
  and transaction handling remain simple.
- Infrastructure and HTTP details stay outside business services. The dashboard
  similarly separates page coordination, views, forms and API transport.
- A shared process/database is still a shared availability and scaling boundary.
  Module separation alone does not establish production capacity or security.
- SQLite repository operations and the unit of work are synchronous. Moving to
  an asynchronous PostgreSQL client requires explicit contract changes, awaited
  transactions, schema migration and concurrency tests; it is not a drop-in swap.
- Revisit TypeScript and API schema generation before additional client teams
  depend on the interfaces. Revisit service extraction only when measured load,
  isolation or team ownership requires it.

AI may suggest or assist through application commands. Fare acceptance, payments
and operational permissions remain explicit deterministic decisions.
