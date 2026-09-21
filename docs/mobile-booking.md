# Native ride requests

Release 0.22 / mobile 0.6 extends native requests to Standard/SUV rides and
van/truck/motorcycle deliveries. Schema 16 preserves accounts and saved journeys;
[category workflows](vehicle-categories.md) describes parcel fields, category-bound
quotes, approved capacity matching and recipient codes. Release 0.23 / mobile 0.7 adds [native driver, fare, chat and trip controls](mobile-journeys.md). No new routing provider is required: delivery
estimates use direct distance without a driving ETA. This is a development preview
with no live transport or payment.

## Customer flow

1. Select a vehicle category and add parcel/recipient details for deliveries.
   Choose **Abuja address**, enable search after reading its provider disclosure,
   then explicitly search/select both addresses. Merely typing sends nothing.
   The screen does not request GPS permissions or track the phone.
2. Review the category fare and endpoints. Passenger trips show road distance and
   non-traffic driving time; deliveries show direct distance and no driving ETA. A proportion-preserving SVG outline uses returned geometry
   over a decorative grid, not street tiles or live tracking. No third-party
   requests run from the native view; existing server provider adapters do that.
3. Tap **Request a driver · preview** after reviewing the endpoints and fare.
   A suggestion never accepts a fare or confirms a booking. This creates the same
   request the web driver queue already understands.
4. Monitor the current request and registered vehicle when a driver takes it.
   Open the native journey to negotiate, chat, confirm and finish, or continue
   on the website using the same account. No token goes in a URL.
5. Cancel a permitted pre-start journey after confirming. Expiry/cancellation
   replace the waiting card when refreshed. Completed journeys remain in Activity.

Local development also provides **Sample journey**, with server-listed areas and
fictional fares. Sample previews do not calculate roads or travel times. Hosted
staging disables sample preview and creation server-side. When configured maps
are off and samples are disabled, planning shows unavailable; it does not silently
fallback or change hosting configuration. See [provider setup](locations.md).

## Native v1 transport

All paths start with `/api/mobile/v1`; all require a valid personal-account bearer.
Success returns HTTP 200 plus `apiVersion: 1` and server milliseconds `serverNow`.
The staging tester gate, native rate/body limits and cookie/origin isolation apply.

| Method/path | Input | Result |
| --- | --- | --- |
| GET `/booking` | none | Enabled providers/hostnames, local sample areas, current customer requests, driver-work/online blockers |
| POST `/booking/search` | `{query}` | Bounded Abuja results and attribution |
| POST `/booking/quotes` | `{pickup:{name,lat,lng},destination:{name,lat,lng}}`, Idempotency-Key | Durable route preview, 15-minute expiry, server suggestion and `{quoteId}` request payload |
| POST `/booking/sample` | `{pickupId,destinationId}` | Local sample preview; creates no ride |
| POST `/booking/requests` | `{quoteId}` or local sample IDs, Idempotency-Key | Current customer request, replay marker |
| GET `/booking/requests/:id` | none | Own customer request status and public assigned driver/vehicle |
| POST `/booking/requests/:id/cancel` | `{expectedVersion,reason}`, Idempotency-Key | Existing cancellation rules and refreshed request |

The projection omits other customers, contacts, pickup PINs, chat, documents and
staff internals. Even the assigned driver cannot use the customer-only detail or
cancellation endpoints. The separate native `/work` and `/journeys` adapters now expose driver dispatch and negotiation.

`http/mobile-booking.mjs` is a transport adapter, not a second booking engine.
It delegates to `rides` and `locations`. The locations planning port rechecks
native session expiry/revocation after provider I/O. Browser location sharing
keeps its separate cookie/session/window authorization; native planning does not
enable GPS sharing. Existing transactions own quote consumption, conflict rules,
idempotency, cancellation and audit events. No client-supplied fare is accepted.

The native client owns network transport; `src/booking/controller.ts` owns the
ephemeral workflow, and separate components render forms, routes and requests.
Runtime wire readers and declarations are in `packages/shared/src/mobile-booking.*`.
No new runtime dependencies, background worker or native permissions were added.

## Recovery and limits

- Duplicate taps are locked while writing. An uncertain response retains the
  exact command key, payload and version for explicit retry, including after access
  token rotation. Editing is disabled until that action has a definite outcome.
- Draft addresses/consent/previews/retry commands stay in memory, not SecureStore.
  Leaving the screen/restarting reloads current server requests. An expired request
  can be found in Activity. There is no persistent offline request queue.
- Status refreshes every ten seconds only while focused and foregrounded. A manual
  refresh is available. Failed refreshes disable new changes until reconnection;
  account changes reject late private responses. Old search results cannot replace
  edited selections. Background privacy remains owned by the session provider.
- Preview expiry uses server time plus monotonic elapsed time; the server remains
  authoritative. Changing an endpoint clears its preview. No quote or fare can be
  silently substituted during confirmation.
- Small screens stack form/review; wide tablets use two columns. Large text returns
  to a single column. Controls use existing safe-area, keyboard, accessible labels
  and selection sheets. Actual device layout/accessibility review remains pending.

## Local acceptance

Follow [mobile setup](../apps/mobile/README.md) with Node 24 and the backend running.
Keep the existing database; do not reset it. In Expo choose **Home → Book a ride →
Sample journey**, select two areas, preview, then request. The website account's
history and an approved online driver's sample queue must show the same request.
Use a separate browser account for the driver; take the request, then refresh the
native screen to inspect its registered vehicle. Continue negotiation on web.

Before a device pilot, test on iPhone, Android and tablets: long address results,
large text, keyboard/selection sheets, both orientations, route proportions,
background/resume, expired preview/request, real provider errors, lost submission
and cancellation responses, another device changing the version, driver-work
conflicts, and account switch/revocation while requests are in flight. Confirm a
cancelled/expired request never keeps showing as waiting. Use a reachable protected
HTTPS origin for physical phones; Alibaba hosting setup remains separate.

Automated tests use fixture providers, real HTTP/SQLite and native controller/client
tests. Bundle exports check both platforms but do not verify a signed app, device
layout, real route providers, driver arrival, notifications or app-store readiness.
Next: native driver availability/request acceptance, fare negotiation/chat and the
remaining trip lifecycle. Native voice, live GPS, push and staffed safety follow
with their respective permission and operational work.
