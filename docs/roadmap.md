# Delivery milestones

## 0 — Repository foundation (implemented)

- Record the accepted product scope and open decisions.
- Establish the app, service, shared code and documentation directories.
- Implement and test explicit fare offers, counteroffers and agreement.
- Provide a local terminal demonstration.

## 1 — First browser experience (implemented preview; visual review pending)

The Taxi Ai landing page and ride-request form now use clearly identified sample
locations and fictional fares. Eats, courier and autonomous taxis have accurate
availability labels. The local demo connects suggestion, offer/counteroffer and
confirmation to the tested shared fare module, with mobile/tablet/desktop CSS.

Complete the manual browser review in `apps/web/README.md` before treating layout
and end-to-end interaction as verified. The current cloud browser blocked local
preview access. Vendor authentication remains a later milestone.

## 2a — Local accounts and saved ride requests (implemented; browser review pending)

- Customer/driver password accounts and role-specific dashboards.
- Local first-administrator setup and pending driver approval with vehicle details.
- SQLite storage, session cookies and server-side access checks.
- Persistent test requests, exclusive driver claiming, fare negotiation and history.
- Versioned transactions, duplicate-request protection and server-controlled expiry.
- Three-second dashboard polling, separate browser sessions and restart durability.

This milestone uses sample areas and fictional fares. Approval enables local
testing; identity and vehicle verification are not implemented. An agreed test
fare does not dispatch a car. Follow the manual checklist in `apps/web/README.md`.

## 2b — Private ride chat (implemented; browser review pending)

- Persistent plain-text conversation for the customer and assigned driver only.
- Unread counts, monotonic read cursors, pagination and retry-safe sends.
- Structured fare cards and explicit acceptance using the existing ride rules.
- Message reports and a limited administrator review queue.
- Schema-two migration preserving existing local data.

Complete [the browser chat checklist](chat.md#manual-review). Staffed safety
operations and production communication security remain planned.

## 2c — Complete test ride journey (implemented; browser review pending)

- Customer booking confirmation at the immutable agreed fare.
- Driver departure, arrival, PIN-verified start and trip completion.
- Participant availability checks, durable PIN cooldown and retry protection.
- Pre-start cancellation with actor/reason, trip activity and paginated history.
- Schema-three migration preserving existing accounts, fares and conversations.

Follow [the trip guide](trips.md) for the contract and manual browser review.
Audio calling is implemented in the following milestone.

## 2d — In-app audio preview (implemented; real audio/browser/relay review pending)

- Participant-only calls with explicit answer, decline, mute and hang-up controls.
- Session/window ownership, one active call per person and bounded setup/heartbeat timeouts.
- Retry-safe audio signaling, recent call history and atomic cleanup on trip closure.
- Local WebRTC mode and configurable coturn relay credentials; no recording or transcription.
- Schema-four migration preserving earlier local data.

Follow [the voice guide](voice.md) for manual browser and cross-network validation.
No relay service is provisioned and no working-audio claim is made by automated tests.

## 2e — Abuja locations (implemented; provider/browser/GPS review pending)

- Explicit online-map consent, manual address search and keyboard/click map pins.
- Server-owned road-route quotes with distance, estimated driving time and an
  illustrative fare formula, followed by the existing negotiation flow.
- Driver-controlled GPS on confirmed trips, participant-only visibility and
  session/window ownership, stale indicators and automatic expiry/cleanup.
- Configurable Photon/OSRM/tile adapters and schema-five data preservation.

Follow [the location guide](locations.md) for public-provider limits and manual
checks. No claim of verified live routes, browser GPS or production tracking is
made by fixture tests. Local mode binds to loopback; private staging uses the configured HTTPS gateway.

## 2f — Private staging preparation (implemented; deployment/device review pending)

- Separate local/staging configuration, canonical HTTPS origin and trusted gateway.
- Invited tester access plus secure account cookies and existing role/CSRF checks.
- Persistent container storage, non-overwriting sanitized backup/restore commands.
- Internal health probes, request IDs, redacted operational fields and shutdown draining.
- Full HTTP ride-journey regression, Node matrix and isolated container CI checks.

The [staging guide](staging.md) includes deployment, recovery and consolidation
review steps. A hosting account/domain, provider connectivity and real browser/
device testing are still required. CI builds/tests containers; it does not publish
a site or schedule off-host backups. Alibaba Cloud was selected for future hosting;
setup is paused while the account payment issue is resolved.

## 2g — Driver availability and nearby matching (implemented; browser/device review pending)

- Explicit Online/Offline availability with separate GPS consent and session/window ownership.
- Fresh nearby request matching: 5 km, then 10 km after one minute; unclaimed requests expire after five minutes.
- Atomic claim and availability cleanup; original fare, chat, booking and pickup-PIN flow preserved.
- Local sample-area matching for tests outside Abuja, disabled in hosted staging.
- Schema-six preservation, backup sanitization and transaction/lifecycle regression coverage.

Follow [the matching guide](matching.md) to test in VS Code without hosting.
Real browser, device location and end-to-end voice review remains outstanding.

## 2h — Simulated payments and earnings (implemented; browser/printing review pending)

- A completed ride creates an unpaid record using the exact booked fare.
- Customer-controlled local success/failure simulation, versioned attempts and safe retries.
- Saved participant receipts, printable with clear simulation notices.
- Driver all-time gross/simulated-paid/outstanding totals and paginated trip records.
- Administrator payment metadata, schema-seven preservation and completed-trip backfill.
- Simulation writes disabled in staging; no provider credentials, real funds or payouts.

Follow [the payments guide](payments.md) for local testing and manual review.
Paystack test integration follows account setup and a separate provider milestone.
Alibaba Cloud hosting remains paused.

## 2i — Real ride pilot

Harden authentication and hosting; add verified driver onboarding, production mapping, vehicle
matching, operational booking state, verified payment-provider integration and live receipts. Implement authenticated
production messaging operations and validate the voice relay on target networks/devices. Exercise concurrency, permission checks and
recovery from interrupted requests before enabling real transactions.

## 3 — Delivery and operations

Build food-vendor menus and order management, courier parcel workflows,
motorcycle delivery, larger-vehicle selection and operational support tools.
Pilot coverage, delivery capacity and vendor operations before expanding.

## 4 — Mobile and intelligence

Deliver the customer and driver apps for iOS/Android, with tablet layouts.
Add evaluated fare/ETA models and bounded AI assistance as data and operational
readiness permit. The website and native app milestones can overlap once their
shared API is stable.

## Future — Autonomous services

Keep robotaxi bookings unavailable until suitable operating partners, vehicles,
service readiness and applicable approvals are established. No date is committed.
