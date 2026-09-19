# Driver availability and nearby requests

This milestone adds explicit driver availability and rule-based matching to the
existing test ride flow. An available request is an invitation to start a fare
conversation. A successful claim selects one driver; it does not accept a fare,
confirm a booking or dispatch an actual vehicle.

## Try it locally without hosting or GPS

Use `feat/driver-matching` and Node 22.12 or later:

```bash
git fetch origin
git switch feat/driver-matching
git pull --ff-only origin feat/driver-matching
npm run verify
npm run dev
```

Open http://localhost:3000/app. Follow the root README to create separate customer,
driver and administrator accounts and approve the driver. Keep customer and driver
in separate browser profiles/windows. Ordinary tabs share the account cookie.

1. On the driver dashboard, under **Your availability → Local testing**, select
   **Wuse II** and click **Go online in sample area**. Keep that page visible.
2. As the customer, create a **Sample-area demo** request from Wuse II to Maitama.
3. Within the normal three-second refresh, the driver sees a **Local sample-area
   match** under Nearby requests. Choose **Start negotiation**.
4. Availability stops. Use chat, offers/counteroffers and explicit acceptance as
   before, then confirm the booking and complete the pickup-PIN test journey.
5. After completion or cancellation, choose Go online again for more requests.

Sample mode never invokes browser geolocation, sends fabricated coordinates or
claims a driving ETA. It matches only sample requests with the same pickup area.
It cannot claim a road-route request, and GPS mode cannot claim sample requests.
The customer and driver can therefore test locally outside Abuja. The original
homepage fare demonstration also remains available.

Only local runtime enables sample matching. Staging rejects sample availability
and new sample ride requests, and hides their controls. Hosted testing needs a
configured map provider, route quotes and drivers with fresh Abuja device positions.
Existing saved sample journeys remain readable and can finish their prior flow.
Alibaba Cloud is the selected future host; setup is paused while payment is resolved.
No cloud resource or paid service is required for the local sample journey.

## Matching policy

| Rule | Preview behavior |
| --- | --- |
| Approval | Drivers start offline, including after administrator approval |
| GPS consent | **Share location and go online**, followed by browser permission |
| Initial search | Within 5 km of the pickup in a straight line |
| Expanded search | Within 10 km from exactly 60 seconds after request creation |
| Request deadline | Unclaimed requests expire at exactly five minutes |
| Ordering | Nearest first, then oldest request and ID; up to 50 eligible requests |
| GPS freshness | Captured less than 30 seconds ago; at most 5 seconds of future clock skew |
| GPS quality | Inside the Abuja preview rectangle; reported accuracy at most 200 metres |
| Availability lease | Last accepted heartbeat less than 60 seconds ago; GPS freshness also applies |
| Browser publishing | At most once per 10 seconds; reacquires a stationary GPS fix before it ages out |
| Stop | Explicit Offline, hidden/closed page, claim, lost session/approval, stale GPS or lease expiry |

The radius is a preview policy, not an official service boundary. Device positions
are self-reported and do not prove physical presence. Distances are not road travel
times. No AI model, traffic service, multi-driver bidding, push notification or
background mobile location service is added by this milestone.

All eligible online drivers can see an unclaimed request. A wider search makes it
available to additional drivers; new eligible drivers can also see it while the
search remains open. There is no exclusive timed invitation to one driver before
claiming. The server rechecks approval, workload, live availability, location,
distance, request deadline and version inside the claim transaction. Only one
claim succeeds. Going online again during an active negotiation or trip is blocked.
Existing agreed-but-unbooked fare behavior and confirmation-time workload checks
are preserved; agreement alone is not a confirmed reservation.

Only **unclaimed** requests expire. Claimed negotiations, agreed fares and bookings
retain their existing lifecycle. To change drivers after claiming, cancel the
journey and create a new request. Chat, fare history and participant identity are
never silently transferred to a replacement driver. An expired request is retained
in customer history as **No driver found · expired**. A new request needs an explicit
customer action; routed requests require a fresh, unused route quote.

## Consent and privacy

Availability uses a separate session/window-bound lease from trip GPS sharing.
The server keeps only its latest accepted position. Available-request projections
show approximate pickup/destination areas and a rounded-up kilometre distance,
without exact route geometry, pickup labels or customer identity. The availability
API returns state and ownership, never coordinates or session/window hashes.
Customers and administrators cannot read a driver's availability endpoint.

Claiming atomically erases availability coordinates and ownership. It does not
start trip tracking; after booking, the assigned driver separately chooses whether
to share location with the customer. Offline also clears the current position.
Audit records contain event type and IDs, not GPS coordinates. Backups sanitize
availability along with sessions, call setup and trip location sharing.

The browser stops its watcher immediately on Offline. An interrupted stop request
may leave server state until expiry, so the UI offers retry and explains the limit.
Late permission, start, poll and position responses cannot restart a cancelled
watcher or overwrite another account's state. Only the initiating session/window
publishes updates; another authenticated window of the same driver can stop it.
Refresh does not automatically request location permission or recreate availability.
An abandoned browser window's lease expires within one minute, often sooner for GPS.

Browser location requires a secure context and user permission; see the
[W3C Geolocation specification](https://www.w3.org/TR/geolocation/). Keep the driver
page visible: switching tabs or locking a device takes this web preview offline.
Native app/background availability remains future work.

## API and module ownership

`modules/availability/` owns `driver_availability` and `availability_commands`.
Rides owns request deadlines and matching/claim rules. The composition root injects
`positionFor`, `onClaim` and workload/session lookup ports; modules never import
each other's repositories. Provider requests remain outside SQLite transactions.
Matching filters before limiting results, so older distant requests cannot hide
nearby candidates behind a pre-filter page limit. This single-process preview scans
open requests; a larger deployment needs indexed geospatial candidate retrieval.

| Method and path | Contract |
| --- | --- |
| `GET /api/availability` | Driver's state and settings; `X-Availability-Client` identifies ownership |
| `POST /api/availability/online` | `{mode: "gps", position: {lat,lng,accuracy,capturedAt}}` or local-only `{mode: "sample", areaId}` |
| `POST /api/availability/:id/offline` | Empty object; same driver's sessions may stop this exact lease |
| `POST /api/availability/:id/position` | `{sequence, position}` for GPS; `{sequence}` heartbeat for sample mode |
| `GET /api/rides` | Existing own rides plus eligible nearby requests and `matchingSettings.allowSimulation` |
| `POST /api/rides/:id/claim` | Existing `{expectedVersion}`; now also rechecks availability and distance |

All writes require same-origin JSON, session CSRF and `X-Availability-Client` for
availability mutations. Online/Offline also require an `Idempotency-Key`. Position
updates use monotonically increasing sequences; a repeated update does not renew
the lease. Online retries return the saved current state, including an ended lease,
and cannot turn a stopped driver back online. IDs and time come from the server.

The five-second maintenance task clears expired availability and unclaimed requests.
Availability reads/updates also sweep; ride reads/commands sweep request expiry.
Claim validation checks freshness independently, so a late maintenance tick cannot
allow a stale match. Expiry commits before a failing ride command, preventing a
rejected late claim from rolling back the deadline transition. A failed claim's
retry/audit write instead rolls back the claim and availability closure together.

## Migration and validation

Migration `006_matching.sql` upgrades schemas 1–5 to 6 without resetting accounts,
sessions, fare events, trips, PINs, chats or route quotes. Existing requested rides
receive `created_at + five minutes`; already-old requests expire on the next sweep.
All drivers start offline. Expired requests retain storage status `cancelled` with
`closed_reason=request_expired`; the API projects the distinct `expired` status.
No fabricated participant cancellation activity or fare acceptance is written.

Earlier branches cannot open a schema-six database. Before upgrading an existing
database, use the previous release's backup command and retain that release for
recovery: backup/restore validation is schema-specific. New snapshots clear all
availability positions and ownership, so restoration never puts drivers online.

Automated tests cover permissions, sample/GPS separation, radius expansion,
competing claims, exact expiry, session/window ownership, stale/replayed updates,
transaction rollback, restart, migrations and snapshot sanitization. Client tests
use device/DOM fixtures for consent, stop, delayed responses and recovery. These
are not real browser/GPS/voice tests. No blocked preview access is bypassed.

Before treating the preview as ready, manually check:

1. Customer and driver journeys at phone, tablet and desktop widths, including
   keyboard navigation, status messages and usable Offline controls.
2. The sample flow above; mismatched areas see no request. Leave a request unclaimed
   for five minutes and verify expiry, history and a new customer request.
3. GPS on an Abuja device over HTTPS: approve/deny permission, check near/far pickup
   matching, then hide the page, revoke permission, interrupt the network and stop.
4. Two drivers claim the same request; only one starts the conversation. Check that
   the other driver cannot access its exact pickup, chat, call or fare records.
5. Complete a negotiated booking and PIN journey. Availability must remain off until
   the driver explicitly goes online; trip GPS still needs separate consent.
