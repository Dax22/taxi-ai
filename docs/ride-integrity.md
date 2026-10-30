# Ride integrity: review-only pickup signals

This step addresses a known Taxi Ai risk: a driver may stop using mobile data after reaching a passenger, renegotiate outside the app and collect an unrecorded fare. A server cannot distinguish intentional data switching from normal mobile coverage, a dead battery, a backgrounded app or permission loss. The implementation **does not claim to detect off-app payment**.

## Signals collected

1. **GPS update gap after pickup arrival**: a passenger ride remains in `arrived`; the driver previously shared an actual GPS position within 30 seconds of that arrival (starting a share alone is insufficient); at least two minutes have passed since arrival; and the latest accepted position is at least 90 seconds old. The server periodically checks the existing location-share timestamps. It does not start device tracking or read GPS outside active sharing.
2. **Cancellation after pickup arrival**: an actual passenger trip (not a parcel) was cancelled after the `arrived` milestone and before PIN-verified trip start. The existing cancellation actor and reason code are copied from the ride activity record. Recent cancellations can be picked up after a worker restart (seven-day lookback).

The indicators are stored once per `(ride, kind)` in `ride_integrity_signals`, with no raw coordinates, phone identifiers, chat contents, or personal-home history. Records expire after 180 days; reviewer command keys expire with the associated signals.

## Staff review

Operations staff with `moderation.read` may visit **Admin → Operations → Ride integrity** or GET `/api/admin/console/ride-integrity` (filter by `state=open|reviewed|dismissed|all`). A limited, cursor-paginated list links to ride details. `moderation.manage` may record a reasoned `reviewed`, `dismissed`, or reopened `open` decision. Existing admin session, MFA, CSRF, optimistic version, idempotency-key, and audit controls apply.

No warning, restriction, suspension, fare, refund, commission, payout, trip status, driver ranking, emergency escalation, or cash-payment state is changed by these signals. Staff must corroborate with both parties, technical availability, and authorized trip evidence, and follow the established moderation process separately. Customer-initiated cancellations and weak GPS coverage can create harmless observations. A later ML anomaly model must be shadow-evaluated on verified labels and legitimate outage cases before any policy change is considered.

## Deployment and validation

- Apply SQLite migration `060` or PostgreSQL migration `034` with the normal migration mechanism before running the updated API/worker binaries.
- Run `node --experimental-sqlite --test packages/shared/test/ride-integrity.test.mjs services/api/test/ride-integrity.test.mjs`, followed by `npm run verify` and PostgreSQL CI tests.
- Verify the new staff queue with an approved staff login. Do not treat an empty queue as proof of no off-app activity: the detector currently only covers recorded arrivals, active GPS sharing and cancellations, and cannot observe unreported cash transactions.
- Deploy through the existing reviewed release workflow. This feature branch does not itself publish to `taxiai.app`.
