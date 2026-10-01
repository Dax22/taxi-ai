# Nigeria-wide locations — development preview

The account dashboard can search Nigerian addresses, select map pins, save a road
route quote and share the assigned driver's browser-reported location during a
confirmed test trip. Fare negotiation, chat, voice controls and pickup PINs use
their existing rules. This milestone does not dispatch a vehicle, take payment,
verify physical arrival. Native installed builds support explicit [foreground and background work location sharing](mobile-trip-location.md).

## Try it locally

Run `npm run dev` and open `http://localhost:3000/app`. Use separate browser
profiles for the customer and approved driver. No map API keys or extra map package installation
are required for the default public mapping services.

1. As the customer, click **Enable online maps** after reading the provider note.
   Type an address or landmark and click **Search** for each endpoint. Searches
   are manual; typing does not send an autocomplete request.
2. Alternatively choose Pickup or Destination, then click the map, use its arrow
   and zoom controls, press Enter on the map to select its centre, or enter
   coordinates. Pins must be within the preview area and at least 100 m apart.
3. Click **Preview route and suggested fare**. A successful provider response
   shows road geometry, kilometres, estimated driving minutes and a suggested
   test fare. If a service fails, the app shows an error; it does not fabricate a
   road route. Map tiles can fail while coordinate controls remain available.
4. Click **Request this test ride** within 15 minutes. The server owns the quote
   and permits its use for one ride. A driver claims the request, both people
   negotiate, and the customer confirms the agreed fare as before.
5. During the booked/on-way/arrived/in-progress trip, the driver must click
   **Share my location** before departing, arriving or starting the trip, and grant browser permission. The customer sees the
   latest reported position, accuracy and age. Click **Stop sharing** to stop
   the device watcher immediately and ask the server to clear the saved point.

The original **Sample-area demo** remains available without mapping services.
Maps start disabled in each account session. GPS never starts from login, polling,
map enabling or booking confirmation. Map opt-out stops external tile loading and
new search/route requests; it is separate from **Stop sharing**. Initial location
permission requests cannot be cancelled by the browser API, but late results are
discarded after stopping or changing accounts/journeys.

## Coverage, route time and pricing

The shared Nigeria boundary now validates address results, pickup/destination
points, road geometry and driver GPS. A bounding box narrows provider search;
the polygon check excludes neighboring-country points inside that box.
This is a software coverage gate, not a promise of available local drivers or
an authoritative border survey. See [nationwide coverage](nationwide.md) for the
boundary data source and limits. Address coverage depends on the provider's
OpenStreetMap data. Road snapping
is limited to 250 m; endpoints and returned geometry are checked server-side.

OSRM supplies car-road distance and estimated driving time. The display excludes
live traffic and the driver's arrival time at pickup. It is not a live ETA model.
Routing does not establish a road's current accessibility or suitability for
real operations. Motorcycle delivery routing is a future Eats/courier decision.

New road quotes are bounded to 2,500 km and 48 hours; driver matching remains
within the existing local radius of the pickup. National route support does not
automatically offer distant drivers a journey or guarantee an interstate service.

The policy `nigeria-preview-v1` uses **₦500 base + ₦200/km + ₦30/minute**, with a
**₦1,000 minimum**, rounded up to **₦50**. Distance is rounded up to metres and
duration to seconds; each component is rounded up to integer kobo before the
final fare increment. For a fixture route of 7 km and 20 minutes, it suggests
₦2,500. This is an illustrative formula, not an AI model or validated market
price. It excludes tolls, parking, traffic/surge charges and platform commission.

A route quote never accepts a fare. The other participant must explicitly accept
the current offer; free text and spoken agreement cannot change the saved fare.
Old sample quotes and saved agreements retain their existing values.

## Provider configuration and usage

| Environment variable | Default / contract |
| --- | --- |
| `TAXI_AI_MAPS_MODE` | `community` or `off`; off disables online search, routes and tiles |
| `TAXI_AI_SEARCH_URL` | `https://photon.komoot.io/api/`; Photon-compatible search endpoint |
| `TAXI_AI_ROUTING_URL` | `https://routing.openstreetmap.de/routed-car/route/v1/driving/`; OSRM car route prefix |
| `TAXI_AI_TILE_URL` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png`; exactly one of each placeholder |

Use these variables when starting the server, for example:

```bash
TAXI_AI_MAPS_MODE=off npm run dev
```

Overrides require HTTPS, except loopback HTTP for development. Credentials,
queries and fragments in these URLs are rejected. A provider needing secret-key
headers needs a server adapter change; never embed secrets in the tile template
or client code. Overrides must preserve attribution and provider contracts.
Production needs dedicated/self-hosted capacity and reviewed provider terms;
public services are not a production SLA or an unlimited resource.

- [Photon's public demo guidance](https://github.com/komoot/photon) permits
  reasonable request volume but warns of throttling and no availability guarantee.
  Search uses its [API contract](https://github.com/komoot/photon/blob/master/docs/api-v1.md),
  an NG country filter, the Nigeria bounding box and a maximum of eight results.
- [FOSSGIS routing policy](https://routing.openstreetmap.de/about.html) limits
  its demo to one request per second. The adapter identifies Taxi Ai, rejects
  bursts inside 1,100 ms per provider kind, coalesces duplicate in-flight requests
  and caches search results for reuse for an hour and routes for five minutes.
  Its shared cache holds at most 100 entries. Provider response reads have an
  eight-second deadline and a 1 MB cap. Redirects are rejected.
- [OSM tile policy](https://operations.osmfoundation.org/policies/tiles/) requires
  attribution, identification and normal caching. The browser loads only the
  visible viewport, sends an origin-only cross-origin Referer, uses normal HTTP
  caching and never prefetches/bulk-downloads tiles. The map links attribution
  and **Fix the map**. `connect-src` remains same-origin; CSP allows only the
  configured tile origin for external images.

These are development controls for one local server. They do not coordinate
limits across multiple application processes or machines. See the
[OSRM API](https://project-osrm.org/docs/v5.24.0/api/) for geometry/time units.

## Privacy, ownership and retention

Enabling online maps tells the user which hosts provide search, routing and tiles.
Submitted search text goes from the server to Photon; selected route coordinates
go to OSRM. Those providers see the server's connection address and may keep
their own logs. Tile hosts receive the browser's connection address, Referer
origin and visible tile areas, which can reveal approximate locations. The
server's bounded provider cache can retain queries/route results until eviction
or process shutdown, even after their reuse TTL expires.

Driver GPS updates go only to Taxi Ai's API. They are not sent to search/routing
providers, although visible map tiles can disclose the area being viewed. GPS is
stored and sent for this local preview; it is not end-to-end encrypted. The
location routes remain customer/assigned-driver only. Explicit private trip links
can disclose the available shared position to their recipients, and a manual test
SOS freezes it for the reporter and administrators. Neither starts GPS; see
[Trip Safety](safety.md). Administrators cannot use location routes to inspect
positions outside that saved evidence. Before a driver claims a request, its available
list shows approximate coordinates rounded to two decimals, without exact point
labels or route geometry. Claimed participants can see the saved planned route.

Only the driver's initiating session/window can publish GPS. Another window of
that approved driver may stop it. Sequences increase monotonically, and older
fixes cannot replace newer ones. The server accepts only in-area coordinates,
accuracy within 200 m, a capture age under 30 seconds and at most five seconds of
future clock tolerance. These checks cannot prove genuine GPS or prevent a
modified client from reporting a false location. Positions are labelled as
browser-reported, with stale points marked **Last known location** at 30 seconds.

The browser sends at most one position update every 10 seconds. An unacknowledged
publication for 45 seconds stops its continuous watcher while the page is running.
No fresh fix means updates stop being sent; an abandoned server share expires
60 seconds after the last accepted update. Reads/writes enforce the lease and a
five-second server sweep performs cleanup. Frozen or sleeping tabs cannot
guarantee timely JavaScript execution; sharing never auto-resumes. See the
[Geolocation specification](https://www.w3.org/TR/geolocation/) for browser
permission and secure-context requirements.

Stopping, trip closure, revoked/expired session or lost approval logically clears
the latest position and ownership hashes. Leaving the selected journey/signing
out closes the browser watcher and attempts server cleanup. A failed stop request
shows a retry message; the lease still expires. Completion/cancellation clears
sharing inside the ride transaction. No breadcrumb history is kept. A saved test
SOS retains its frozen location snapshot after GPS stops, including in backups;
ordinary audit events contain only record IDs, not coordinates.

Consumed quotes retain exact pickup/destination/route details with ride history.
Unconsumed quotes expire after 15 minutes and are pruned with their retry keys
once more than one hour past expiry. Reusing a pruned quote key may create a new
quote; it cannot resurrect the old ride. Share metadata and retry records persist
without GPS after stop. SQLite deletion is logical, not guaranteed forensic
erasure from database pages, WAL or backups. Production retention, deletion,
encryption and operator access need a separate implementation.

## API and persistence

| Method and path | Contract |
| --- | --- |
| `GET /api/locations` | Eligible customer/approved driver; safe provider settings and coverage |
| `POST /api/locations/search` | `{ query }`; 3–160 characters; bounded results |
| `POST /api/locations/quotes` | Customer; `{ pickup: {lat,lng,name}, destination: {lat,lng,name} }`; returns saved quote |
| `POST /api/rides` | Customer; `{ quoteId }`; consume own nonexpired quote once |
| `GET /api/rides/:id/location` | Assigned participants; latest active share or null |
| `POST /api/rides/:id/location/start` | Assigned approved driver during confirmed trip; `{}` |
| `POST /api/location-shares/:id/position` | Owning session/window; `{ sequence, lat, lng, accuracy, capturedAt }` |
| `POST /api/location-shares/:id/stop` | Same assigned approved driver, including another window; `{}` |

Every write uses the existing Origin, JSON, session, CSRF and per-user rate checks.
Quotes, ride creation and share start/stop also require an `Idempotency-Key` of
16–128 letters, digits, dashes or underscores. Location mutations require a
page-random UUID-shaped `X-Location-Client`; supplying it on reads returns the
`owned` flag. It is an ownership nonce, not an authentication credential.
Positions use a positive safe-integer sequence instead of a command key.
Times are Unix milliseconds; coordinates are numeric WGS84 degrees and precision
is rounded to six decimals. The browser adjusts fix age against server time.

Provider failures return an actionable error and save no quote. Quote creation
rechecks authorization and retry keys after asynchronous I/O, then atomically
saves quote, key and audit. Limits include ten saved quotes per customer per
minute and the shared 60-write/minute cap. Consuming a quote commits its ride,
binding, audit and ride retry key together. Retrying the same ride command returns
the saved ride even after quote expiry; a different key cannot consume it again.

Migration `005_locations.sql` adds four module-owned tables and indexes, bringing
the schema to 5. It does not rewrite earlier accounts, rides, fares, chat, trip
PINs, call state or signaling. Earlier binaries reject the upgraded database;
use a separate test database when comparing branches. See [architecture](architecture.md).

## Manual review

Automated tests cover bounded/provider-invalid data, retry races and rollback,
quote consumption, participant privacy, session/window ownership, out-of-order
GPS, expiry, trip cleanup, old-schema preservation, DOM bindings and simulated
permission failures. They use fixtures. Live provider connectivity could not be
confirmed from the development environment; real map/browser/device GPS and
responsive accessibility checks remain outstanding. No alternative browser
access was used after the environment blocked local previews.

1. On local Chrome and Safari, check 390/768/1440 px layouts, keyboard focus,
   readable labels/attribution, screen-reader error/status announcements and
   overlapping controls. Resizing a desktop browser is a layout check only.
2. Confirm no external map requests or GPS permission prompt before explicit
   enabling. Enable maps, search known public landmarks in Lagos, Kano, Port Harcourt
   and Abuja, check result
   relevance, place pins with mouse and keyboard, and verify the provider route.
   Test no results, out-of-area pins, no nearby road and provider failure.
3. Confirm suggestion breakdown/distance/time and the lack of live traffic or
   pickup-arrival claims. Change either endpoint while a route loads; the old
   result must disappear. Let a quote expire and request a new one.
4. Book in two separate customer/driver profiles. Check approximate available
   locations, exact points after claiming and unchanged negotiation/explicit
   acceptance. Test refresh/restart and attempts to reuse another user's quote.
5. Confirm no GPS starts from map enabling or booking. Deny permission, grant
   it, stop during the prompt and try an inaccurate fix. Sharing requires an
   Nigerian position; a device outside Nigeria is rejected. Developer-tool
   coordinate overrides can exercise UI states but do not validate real GPS.
6. Where real in-area GPS is available, share as the assigned driver. Check
   accuracy/age, stale indicators, Stop, sign-out, another window's Stop, trip
   completion/cancellation and loss of connection. Delayed responses must not
   resume a closed watcher or show another account's position.
7. The default local server is unreachable from other devices by design. Real
   phone/tablet testing can use the separately configured [private staging
   setup](staging.md). Do not expose local mode or claim mobile/background GPS
   compatibility from fixture tests. Repeat review on target devices after hosting.

## Availability before booking

The [matching milestone](matching.md) adds a separate driver Online/Offline GPS
lease to find nearby requests. It does not reuse trip-sharing consent. Claiming a
request clears availability location; post-booking tracking still starts only when
the assigned driver chooses Share my location. Local sample-area matching uses no
GPS and cannot claim routed requests.


## Mandatory active-work location

Ride and parcel drivers must share a fresh job location before the server accepts
`depart`, `arrive` or `start`. This applies in local previews as well as hosted
operation. A valid sharing lease alone is insufficient: the assigned approved
driver must have published a GPS report less than thirty seconds old from its
owning authenticated session. Tests explicitly publish fixture GPS through the
real endpoints; there is no production bypass for sample bookings.

Booking, price negotiation and customer address entry do not request or require
customer GPS. Going online for matching does not itself share a trip position.
The driver sees why permission is needed and initiates sharing explicitly.
Stopping or revoking permission remains possible; progress is then blocked until
tracking is restored. Cancellation, completion and safety/help controls remain
available. Successful command retries do not re-run the GPS prerequisite.
Native background operation and its OS limits are documented in
[mobile-trip-location.md](mobile-trip-location.md); browser background delivery
cannot be guaranteed.
