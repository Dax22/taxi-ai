# Road pickup estimates and timed driver offers

Taxi AI now offers each unclaimed request to one eligible driver at a time. Both
web and native apps show the invitation, its expiry and a road pickup estimate when
one is available. Accepting the invitation starts the existing fare conversation;
the customer and driver still explicitly agree a fare, and the customer separately
confirms the booking. This remains a development transport flow.

## Choose the matching mode

Set the following server variable in your existing private `.env`, then restart
the server:

```dotenv
TAXI_AI_DISPATCH_MODE=sequential
```

| Mode | Behavior |
| --- | --- |
| `sequential` (default) | Selects the best remaining compatible driver/request pair and issues a timed invitation |
| `batch` | Waits until a request is at least two seconds old, then optimizes compatible pairings together |
| `legacy` | Restores the shared nearby-request list and first valid claim behavior |

Batch mode is available for controlled evaluation; it is not enabled by default.
The worker runs every two seconds, and driver dashboard refresh adds a small display
delay. Allocation considers at most 32 drivers, 32 requests and 512 candidate edges.
Batch optimization maximizes matching count and then minimizes the summed policy
cost within that bounded graph. See [the policy details](smart-matching.md).

There is at most one pending offer per driver and per request, enforced in storage.
An offer lasts up to 20 seconds and never extends the request's five-minute deadline.
Declining, expiry, going offline or losing eligibility can end the invitation. The
worker can then offer the request to another driver. A declined, expired or revoked
driver/request pair is not offered again for the same request.

Claiming requires the server-issued offer ID, current ride version and a still-valid
availability lease. The server rechecks location, approval, category, workload and
deadline during the atomic claim. The offer, driver assignment and availability
closure commit together. A delayed client response cannot revive an old invitation.
The driver is never reassigned automatically after a successful claim: cancel and
create a new request to change drivers. Chat and agreed fares retain their existing
participants and explicit acceptance rules.

## Routing configuration and limits

The adapter reuses existing map configuration:

| Variable | Purpose |
| --- | --- |
| `TAXI_AI_MAPS_MODE` | `community` by default; `off` disables external map requests |
| `TAXI_AI_ROUTING_URL` | Existing OSRM route endpoint and driving profile; its table endpoint is derived on the same origin |

No new provider credentials, paid service or dependency are introduced. The default
OSRM service provides road duration without live traffic. It does not predict traffic
with ML. Dedicated provider capacity is still required for production; community
services have usage limits and may reject table requests or distance annotations.

For GPS requests, matching sends driver and pickup coordinates to the configured
router. OSRM Table requests contain at most 16 uncached directed pairs, use bounded
road snapping and request duration/distance together. Requests share the existing
route rate limit of one new URL per 1.1 seconds with route previews. They do not
enable OSRM's straight-line `fallback_speed`, and any returned fallback-speed cells
are rejected. Custom endpoints without the standard OSRM table path may not support
batched pickup estimates.

The pickup wrapper deduplicates concurrent pairs, caches exact directed pairs for
15 seconds, caches failures for 1.5 seconds and holds at most 256 cache entries.
At most two upstream requests are active; the caller's timeout is 1.5 seconds.
A timed-out request continues occupying its slot until upstream work settles,
preventing unlimited background calls. Matrix data uses the provider's 15-second
cache; standalone route calls retain its existing five-minute route cache.
`estimatedAt` records when the server obtained and validated the result, not traffic
data freshness. No coordinates or route geometry are written to matching telemetry.

Missing, invalid or timed-out road estimates use approximate distance for internal
ranking and show **no pickup ETA**. Sample-area matching also shows no ETA and never
sends fabricated coordinates. The system can still issue invitations when maps are
off or unavailable. Radius eligibility remains straight-line 5 km, expanding to
10 km after one minute; route time affects priority, not these radius limits.

## API and ownership

| API | Contract |
| --- | --- |
| `GET /api/rides` | Driver's invited request includes `offer: {id, expiresAt, etaSource, pickupEtaMinutes}`; `matchingSettings.dispatchMode` identifies policy |
| `POST /api/rides/:id/claim` | `{expectedVersion, offerId}` in sequential/batch mode, plus existing authentication, CSRF and idempotency protections |
| `POST /api/dispatch/offers/:id/decline` | Empty body; only the invited driver can decline, with an idempotency key |
| Native `GET /api/mobile/v1/work` | Same offer projection, availability and mode through native authentication |
| Native `POST /api/mobile/v1/work/offers/:id/decline` | Same server decline operation |
| `GET /api/admin/dispatch/metrics` | Administrator-only aggregate measurement data |

`modules/dispatch/` owns offers and observations. Rides owns eligibility and ride
mutations, availability owns location consent/leases, and infrastructure owns
provider I/O. The composition root injects these ports. Provider calls happen
outside transactions; eligibility is checked again when results return. Before
claiming, offer cards retain approximate areas and rounded distance/pickup minutes;
they do not reveal exact points, customer identity or internal policy scores.

## Measurements

The administrator metrics endpoint reports a rolling 30-day creation cohort. Offer
aggregates are grouped by mode, ETA source and status. Journey aggregates are grouped
by matching mode and `sample` versus `gps`, so local demonstrations can be separated.

| Field | Definition |
| --- | --- |
| `requests`, `matched`, `expired`, `cancelled`, `completed` | Counts in the request creation cohort, reflecting recorded outcomes |
| `meanMatchSeconds` | Mean request-to-successful-claim time, only for matched requests |
| `meanPickupSeconds` | Mean **On my way** to **I have arrived** time, only where both events exist |
| `pickupObservations` | Number of journeys contributing to the pickup mean |
| `meanResponseSeconds` | Offer creation-to-closure time for closed offers in each status group |
| `roadOffers`, `fallbackOffers` | Counts by road versus distance-fallback estimate source; sample offers remain separate |

Missing observations produce null means, not zero-time pickups. Pickup timing is
based on recorded driver actions, not independent GPS arrival verification. It
excludes negotiation and booking time. These measurements are a baseline, not a
trained model, an A/B experiment or proof of reduced waits. A useful evaluation
compares similar locations, driver supply and request volume while examining
expiry, cancellation, coverage and sample sizes alongside averages. No production
improvement or validated ML claim is made.

## Upgrade and recovery

Migration `027_dispatch.sql` adds schema 27 with persistent offers, idempotency
commands and journey observation timestamps. Accounts, fares and existing journeys
are preserved. Previously created journeys are not fabricated into the new outcome
cohort. Pending offers survive an ordinary restart only while still valid; all claim
checks continue to apply.

Before starting the updated release against an existing database:

1. Use the **previous release's** backup command to save a uniquely named snapshot,
   and retain that release/configuration for recovery. Backup validation is
   schema-specific; do this before the new server opens and migrates the database.
2. Stop the old server, update the checkout/dependencies, and start the new release.
   Use the existing database configuration so a different empty database is not
   mistaken for lost account data.
3. Verify sign-in, driver availability, invitation acceptance, fare agreement and
   customer booking confirmation. Inspect metrics using an administrator session.

Setting `legacy` changes matching behavior without downgrading the database. To
roll back code, restore the pre-upgrade snapshot with its matching release into a
new database path; never open a schema-27 database with older code. Current snapshots
clear location/session state and revoke pending invitations, so restore does not
reactivate driver availability or offers. See [operational backup guidance](staging.md).

## Verification checklist

Use local sample requests for deterministic UI checks and authorized Nigerian GPS
devices over HTTPS for location checks. Keep customer and driver sessions separate.

1. Two eligible drivers, one request: only the invited driver can claim; expired or
   declined offers move to another driver, and stale IDs are rejected.
2. Stop availability or revoke eligibility during routing: no stale offer becomes
   claimable. Late responses after logout do not restart device location sharing.
3. Disable maps or simulate routing failure: invitations remain possible, and the
   card shows unavailable road time rather than fabricated minutes.
4. Claim, negotiate, explicitly accept a fare and confirm: invitations do not bypass
   fare consent or silently reassign the driver afterward.
5. In `batch` mode, use simultaneous eligible requests and inspect distinct
   driver/request pairs. Return to `sequential` to compare measured cohorts.
6. Check offer expiry, decline and refresh behavior on web and native, then verify
   metrics access is denied to non-administrators. Physical-device behavior is a
   separate validation from automated service and contract tests.
