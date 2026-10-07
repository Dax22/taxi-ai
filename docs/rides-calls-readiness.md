# Ride and call readiness repair

This branch contains source changes, not an activated production release.
It starts from the existing tracking-hardening snapshot, preserving that work.

## Implemented

- Explicit `TAXI_AI_RIDE_COVERAGE=nigeria` support uses the existing country polygon to check selected endpoints and raw route points. Default hosted requests remain paused. Pilot coverage remains available. Old quotes cannot cross coverage-policy changes.
- The authenticated ride and map-settings responses expose passenger pause/coverage state. The website explains when viewing a map cannot result in a passenger booking.
- Only approved, currently eligible online drivers receive offers. The pre-negotiation offer shows the submitted destination label, but not exact pickup details or destination coordinates.
- The dashboard refreshes an active call's journey context from current server state instead of preserving a stale active status after completion.
- Hosted call configuration defaults to off and rejects local-only mode. Relay credentials reject control characters and oversized secrets. A configured relay is still required.
- `scripts/runtime-readiness.py` runs an allowlisted read-only inspection inside the active app container. It does not change settings, restart services, create users, or print credentials. It saves a redacted report under `/var/tmp/taxi-ai-readiness-*.json`.

## Not activated or established

Docker access is denied to the connected remote account. The active deployment,
private environment file, driver approval records and firewall were not changed.
No TURN server has been provisioned, no phone audio has been verified, and no
production driver count has been established. Buyer-seller food-order calling is
not implemented by this patch. Test fixtures are not production drivers.

Before release, an authorized operator must obtain the runtime inventory, preserve
all runtime-only changes, reconcile the patch, back up the actual database, and
validate the selected deployment configuration. The new coverage variable must be
explicitly passed through the deployment configuration; changing only a host env
file that Compose does not reference is insufficient. The default pause must not
be removed until the selected service coverage, a real approved online driver,
real mapping, payment handling and end-to-end fulfilment have been verified.

For internet calling, configure a compatible authenticated TURN relay, secure its
network access, then configure the existing relay URLs and matching shared secret
privately. Verify two-way audio on separate networks and end an active transaction
while audio is connected. Expiring TURN credentials alone do not revoke an
already-established media session. Strict server-side media cutoff still requires
relay/media-session enforcement beyond client teardown.

## Tests

Tests use disposable SQLite storage, fictional accounts, and mocked media. They do
not charge customers or seed drivers in production. Check the final test logs in
this branch's verification directory before integration. Live PostgreSQL inventory,
actual microphones, mobile networks and background phone behavior remain separate
acceptance checks.
