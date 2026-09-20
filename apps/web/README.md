# Taxi Ai web

Run `npm run dev` from the repository root, then open http://localhost:3000.
The **Your account** button opens `/app`. Node.js 22.12+ works; no dependency
installation or provider credentials are required.

## Client structure

`public/dashboard.mjs` wires browser events and feature adapters. The injected
`public/dashboard/page-controller.mjs` coordinates state, refresh and actions,
clears account data before subsequent reads, rechecks the session before publishing
parallel results, and cancels queued actions after a session change. Other modules in
`public/dashboard/` separate API transport/retry keys (`api-client.mjs`), login and
registration forms (`auth-form.mjs`), role-specific rendering (`views.mjs`) and
small DOM helpers (`dom.mjs`). Views receive callbacks and never call the network.
The homepage's independent sample demonstration remains in `public/app.mjs`.

`conversation-controller.mjs` coordinates chat pages, retries and selected-account
isolation. `conversation-view.mjs` renders plain-text messages and structured fare
cards using `conversation-model.mjs`; `chat-reports-view.mjs` renders the admin
queue. Fare controls retain the existing ride commands and consent rules.
`trip-view.mjs` and `trip-model.mjs` handle booking, pickup, progress and cancellation;
shared lifecycle vocabulary lives in `packages/shared/src/trip-lifecycle.mjs`.
Completed/cancelled/expired history loads in cursor-based pages of 20.

`call-controller.mjs` owns call polling, explicit microphone setup and recovery;
`call-media.mjs` contains the browser WebRTC adapter; `call-view.mjs` renders call
controls and remote audio. The call panel spans journeys, so incoming calls appear
even while another saved journey is selected. Active audio keeps polling when the
page is hidden, subject to browser timer/background restrictions.

`location-planner.mjs` owns map consent, manual search, selected points and route
quotes. `location-sharing.mjs` owns explicit driver GPS and session cleanup;
`geolocation.mjs` is the browser device adapter. `location-view.mjs` binds the
forms and `map-view.mjs` draws visible raster tiles, road geometry and pins with
native SVG. No mapping SDK or new npm dependency is needed. Map rendering loads
only visible tiles after consent; it never prefetches or downloads offline maps.

`availability-controller.mjs` manages separate Online/Offline consent, sample-area
simulation and live availability updates. `availability-view.mjs` owns its controls.
It stops on a hidden page, claim, offline, stale GPS or lost session, and never
starts trip GPS. See [matching](../../docs/matching.md) for the local sample flow.

`payments-controller.mjs` isolates selected-trip payment/receipt requests and paged
earnings/admin records by account. `payments-view.mjs` renders local simulation
controls, printable receipts and exact totals. No checkout SDK or bank/card input
is included. See [payments](../../docs/payments.md) for the full test flow.

`npm run verify` checks imports/module boundaries as well as domain, HTTP/static
serving and client transport behaviour. Client tests cover lost/truncated
responses, stable retry keys, original offer/version preservation and clearing
credentials on session reset. These tests do not replace browser interaction review.
`npm run test:journey` runs the focused customer/driver/administrator HTTP journey
plus dashboard/session regressions with disposable data. See
[pilot preparation](../../docs/pilot-readiness.md) for scope and manual results.

The website retains the approved yellow motion emblem, amber/graphite palette,
pale backgrounds and original concept artwork. See [the brand guide](../../docs/brand.md).
Car illustrations do not depict an operational fleet. Eats, courier and autonomous
services are informational sections with accurate planned-service labels.

## Two working experiences

- `/`: the original landing page and single-browser fare demonstration. Its
  customer/driver role buttons operate only on temporary in-memory sample state.
- `/app`: password registration/sign-in, role-specific dashboards, administrator
  review, persistent test requests and fare negotiation between real separate
  account sessions. Roles and agreements are checked by the local backend.

The dashboard refreshes every three seconds while visible. It keeps an offer's
exact ID and version when sending acceptance and asks the user to review again
after a conflict. Network retries reuse the same mutation key during the page
session. Refreshing the browser reloads saved requests from the server.

`server.mjs` serves an explicit file allowlist and `/api` from the same origin. It
never serves repository configuration or database files. Host/Origin checks permit
only loopback addresses by default. Staging mode uses one configured HTTPS
origin, a gateway token and invited tester access. CSP permits same-origin scripts, styles and API
connections, plus images from the configured tile origin. Inline code and
embedding are disabled. Microphone permission
is enabled only on `/app` while calling is enabled; acquisition requires a Call
or Answer click and browser permission. Geolocation is allowed only at `/app`
and requires an explicit location-sharing action plus browser consent. Camera remains disabled.
The account page sends an origin-only cross-origin Referer for street tiles;
other pages use no-referrer. Address search and routing go through the API.

See [the root setup guide](../../README.md) for creating the first administrator
and using two independent browser sessions. Separate ordinary tabs share cookies;
use a second browser/profile or a private window for the driver.

## Manual browser review

Automated API and domain tests do not establish browser layout, accessibility or
complete browser interaction correctness. The available cloud browser blocks
local server/file previews; visual and browser interaction review is outstanding.

1. Check both pages at 390px, 768px and 1440px widths for overflow, readable text,
   usable controls and correct amber-logo rendering.
2. Use the keyboard through sign-in, registration, vehicle fields, the request
   form and fare controls. Check labels, focus visibility and error announcements.
3. Create customer, driver and separate operator accounts. Promote the operator
   using the documented command, sign in again and approve the pending driver.
4. Submit a customer sample request. In a second visible session, go online as the
   driver in the same sample area, then select it. Offer
   ₦5,000; counter as the customer with ₦4,700; accept as the driver. Check both
   screens, refresh, and restart the server. The agreement should remain.
5. Check that the offer author cannot accept their own price. Let an offer expire
   and verify that a new offer is needed. Open two customer tabs and check that an
   out-of-date acceptance cannot accept or replace a newer driver's offer.
6. Sign out. Protected requests should fail until sign-in. Pending and rejected
   driver accounts should see their status without access to claim controls.
7. Stop the server while a page is open, restart it and use Refresh. Confirm the
   connection status recovers, and retries do not duplicate requests or agreements.
8. Check the original homepage demo, Eats/Courier labels and autonomous section.
   Chat, audio calling and local simulated payments belong to the account preview;
   live payment collection and dispatch remain unavailable. Follow [the chat review steps](../../docs/chat.md#manual-review)
   for message history, unread state, retries, reporting and fare cards.
9. Follow [the trip review steps](../../docs/trips.md#validation-and-manual-review)
   for booking, PIN verification, progress, cancellation and paginated trip history.
10. Follow [the voice review steps](../../docs/voice.md#manual-browser-review)
    for microphone consent, two-way audio, mute, interruption recovery and relay
    checks. Actual audio and browser compatibility remain unverified here.
11. Follow [the location review steps](../../docs/locations.md#manual-review) for
    maps, address results, keyboard pins, route quotes and permission-based GPS.
    Live provider connectivity and browser/device GPS are not established by
    the automated fixtures. The default server remains local-only; mobile layout checks
    do not constitute an installed iOS/Android app or background tracking test.

12. Follow [the matching review steps](../../docs/matching.md#migration-and-validation)
    for Online/Offline, separate GPS consent, local simulation, expiry and competing drivers.
13. Follow [the payment review steps](../../docs/payments.md#validation-and-manual-review)
    for failed retries, saved receipts, earnings, stale sessions and print/PDF output.
14. Follow [the pilot acceptance session](../../docs/pilot-readiness.md#manual-acceptance-session)
    for switching accounts in shared-cookie tabs, interrupted dashboard reads and
    ensuring no old trip, plate, fare, PIN or receipt returns.

The [staging guide](../../docs/staging.md) provides a separate private hosting
configuration for real device review. It is not deployed automatically by GitHub
CI. Invited testers pass a browser access prompt, then use ordinary Taxi Ai
accounts; signing out of an account does not clear the browser's cached tester key.
