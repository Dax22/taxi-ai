# Delivery milestones

The accepted next direction is one Taxi Ai app for iOS/Android and one website
with shared accounts and Customer, Drive & deliver and My store modes. The
[unified platform plan](unified-platform.md) supersedes separate native apps and
moves the mobile foundation earlier. Completed milestones below describe the
prototype; planned milestones do not claim shipped features.

## Current account milestone — Google sign-in (implemented; configuration/device acceptance pending)

Release 0.19 / mobile 0.3 adds Google sign-up and login, safe existing-account
linking, staff isolation and schema-14 identity storage. Credentials belong to the
owner's Google Cloud project. Follow [Google setup](google-sign-in.md).
Next: activate/test Google; add verification, recovery and deletion; complete the
native ride lifecycle with the same APIs. Keep Eats, vendors and courier modules
independent, and add Sign in with Apple before consumer iOS store submission.

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
preview access. Vendor memberships and operations remain a later milestone.

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

## 2i — Journey verification (implemented; real browser/device review pending)

- One `npm run test:journey` command covering registration, operator setup, driver
  approval, matching, private chat, fare agreement, PIN, restart and simulated payment.
- Cross-module checks for lost payment responses, exact receipts/earnings,
  cancellation without billing, outsider rejection and sign-in recovery.
- A separate page controller that clears account data before follow-up requests,
  rechecks sessions around dashboard reads and prevents queued actions crossing accounts.
- Delayed-response/retry isolation and strict-ID DOM fixtures; no schema change.

Follow [pilot preparation](pilot-readiness.md) for the focused check and the pending
manual acceptance session. This milestone does not enable actual transport,
identity verification, real payments or emergency messaging.

## 2j — Driver applications and recorded manual review (implemented; browser review pending)

- Private driver contact/licence/vehicle details and five bounded image documents.
- Submission, rejection/corrections and resubmission, with versioned review evidence.
- Required reviewer downloads, four manual checks and an approval reference/reason.
- Expiry eligibility on new work; active trips and historical vehicle identities preserved.
- Schema-eight upgrade without inventing verification for legacy approved drivers.

See [driver onboarding](driver-onboarding.md). These are recorded manual checks,
not identity-provider validation. Real document processing, reviewer operations
and browser/file-picker testing remain prerequisites for production use.

## 2k — Trip Safety (implemented; browser/device review pending)

- Customer/driver trusted contacts and manual test SOS on confirmed active trips.
- Private immutable trip/driver/plate/location snapshots and administrator review history.
- Explicitly simulated contact notifications, delivery states, bounded retries and cancellation.
- Expiring, revocable trip links with session/trip cleanup and limited bearer reads.
- Schema-nine preservation and backups that retain incident evidence while revoking links.

See [Trip Safety](safety.md). No external messages, police contact, automatic crash
sensing or staffed emergency response are enabled. Manual browser/clipboard,
mobile/tablet, GPS and hosted-recipient testing remain pending. Hosting on Alibaba
Cloud remains paused.

## 2l — Unified accounts and web navigation (implemented; browser review pending)

- Schema-10 customer/driver capabilities preserve existing identities, sessions
  and review evidence; driver approval stays separate from application access.
- Same-login driver enrollment and Customer/Work website modes; staff remains
  restricted, and vendor/delivery services are visibly unavailable.
- Trip-specific ownership, self-claim prevention and conflicting workload checks.
- Mode-scoped history, caches and retry keys; session-scoped calls and active GPS.
- Confirmed offline transition and return paths to active journeys/Trip Safety.

Acceptance: the same eligible account can buy and work, with explicit mode
switching and preserved active-trip/safety access. Automated permission, migration
and client fixtures pass; real browser/device acceptance remains pending. See
[the implementation and review guide](unified-accounts.md).

## 2m — One mobile app, rides first (next; planned)

Build `apps/mobile/` using the proposed React Native + Expo + TypeScript stack.
Deliver one iOS/Android app with phone/tablet layouts, secure sign-in and the same
Customer/Work ride journey as the website. Create a clear mode switcher and
feature boundaries for later Eats, courier and My store capabilities.

Define the native session/revocation and versioned API contract first, then scaffold
the mobile workspace. Connected flows build on 2l’s capability and trip permissions. Integrate and test location, notifications and in-app calling in
development builds on physical devices. The browser website continues to support
the same services, with explicit handling of device capability differences.

## 2n — Real ride pilot (release gate; planned)

Harden authentication and hosting; add verified driver onboarding, production mapping, vehicle
matching, operational booking state, verified payment-provider integration and live receipts. Implement authenticated
production messaging operations and validate the voice relay on target networks/devices. Exercise concurrency, permission checks and
recovery from interrupted requests before enabling real transactions.
Connect the test SOS foundation to verified trusted-contact notification and staffed incident handling with an
agreed emergency-response channel before inviting real passengers.

## 3a — Courier and shared delivery work (planned)

Add parcel details, quotes, item/vehicle limits, pickup/custody, delivery proof,
cancellation and support. Enable approved motorcycle, car and van delivery in the
same Work mode. Enforce worker/vehicle capacity across passenger and delivery
services; no multi-job batching initially. Decide courier pricing before its
checkout or negotiation flow is implemented.

## 3b — Taxi Ai Eats and My store (planned)

Add vendor/store onboarding, scoped staff memberships, menus, inventory, opening
hours, customer checkout, preparation, delivery handover and settlements in the
same mobile app and website. Reuse shared delivery capacity while keeping food
order rules distinct from passenger trips. Pilot coverage, stock consistency,
delivery capacity and vendor operations before expanding. 3a/3b can be
reprioritized, but Eats delivery requires the shared delivery contract.

## 4 — Evaluated intelligence (planned)

Add evaluated fare/ETA models and bounded adaptive assistance as data and
operational readiness permit. Agent tools inherit account/store permissions;
explicit fare acceptance, payments and safety operations remain controlled
application actions. Manual flows must remain usable when AI is unavailable.

## Future — Autonomous services

Keep robotaxi bookings unavailable until suitable operating partners, vehicles,
service readiness and applicable approvals are established. No date is committed.

## Mobile foundation — implemented; device QA pending

One Expo/React Native/TypeScript app now connects to the existing backend with
secure device sessions, Customer/Work navigation, saved activity, driver
enrollment/status and device revocation. Both platform bundles are compiled;
actual simulator/device and signed native build testing are pending. Website
download links remain Coming soon until real listings exist.

Next: native ride booking/negotiation through trip completion, then native
communication/location/safety integrations. The separate [staff dashboard](admin-dashboard.md)
now has audited account/trip views and analytics. Extend it with dedicated staff
sessions, MFA and granular permissions. Real providers and staffed operations
remain gates before a live pilot.
See [mobile setup](../apps/mobile/README.md) and [the v1 contract](mobile-foundation.md).
