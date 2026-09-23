# One Taxi Ai account, app and website

Status: accepted product direction; account/web foundation implemented in 0.14.0.
See [unified accounts](unified-accounts.md) for delivered scope. This document records
the user's request to combine customer, driver, delivery and food-vendor access
before mobile development proceeds. It supersedes the separate customer/driver
mobile-app plan. The website now supports Customer/Work capabilities under one
account. The native app now shares rides and parcel journeys; release 0.24.0
adds Eats, My store and food delivery handovers. See [Eats](eats.md) for the
implemented preview. Broader capabilities below remain the target product.

## Product structure

Deliver one Taxi Ai mobile product, built for iOS and Android, and one responsive
website. Both use the same accounts, service records and backend rules. A person
can start a request on the website and resume its saved state in the app after
signing in. A shared account does not require sharing credentials with staff.

One account may have several approved capabilities. Navigation has three modes:

| Mode | Main activities | Access |
| --- | --- | --- |
| Customer | Book car rides, order Taxi Ai Eats, send parcels, track activity and view receipts | Normal personal account |
| Drive & deliver | Passenger trips, food delivery or parcel delivery, according to approvals and the selected vehicle | Approved service capabilities and current vehicle eligibility |
| My store | Menu, stock, opening hours, incoming orders, preparation, handover and store earnings | Active membership of an approved vendor/store |

Passenger driving and delivery riding share the Work experience, with clear
service filters. Motorcycle approval permits eligible food/parcel jobs, not
passenger car trips. Cars and vans receive only the service permissions and load
limits for which they are approved. A food vendor is a business with members;
it is not a second personal identity or a password shared by restaurant staff.

Platform administration stays in a restricted staff web area. It is never a
publicly selectable profile or a privilege gained through vendor registration.
Robotaxis remain a clearly labelled future service without booking controls.

## Navigation and onboarding

The public website keeps its Taxi Ai landing page and service entry points. Its
signed-in application uses the same mode names and information hierarchy as the
mobile app. The yellow/graphite identity carries across both; working screens
prioritize tasks, readable status and maps over heavy decorative imagery.

| Mode | Phone navigation | Primary screen |
| --- | --- | --- |
| Customer | Home, Activity, Inbox, Account | Ride, Eats and Courier service choices, followed by the selected service's task |
| Drive & deliver | Jobs, Activity, Earnings, Inbox, Account | Current job first; otherwise availability and eligible requests |
| My store | Orders, Menu, Earnings, Inbox, Account | Orders grouped by action needed, preparation and handover |

Use a clearly labelled mode selector beside the profile at the top. Store mode
also names the selected store. Mode and store identity remain visible on detail
screens and consequential confirmations. Tablet/desktop layouts can use a side
navigation and list/detail panes while keeping the same labels and workflows.

- Default a new personal account to Customer. Do not force a permanent role
  choice before booking or ordering.
- Offer "Drive & deliver" and "Sell with Taxi Ai Eats" through Account. Each
  starts a resumable application and shows Draft, Under review, Needs changes,
  Approved or Unavailable as appropriate. Approval never follows from tapping
  the mode selector.
- Show approved modes plus an obvious route to apply for another. Keep pending
  applications easy to find without presenting unavailable operational controls.
- Ask for location, microphone, camera and notifications when a task needs them.
  Explain the purpose and provide a useful denied-permission state.
- Keep the last chosen mode per installation/browser. A change on a tablet must
  not silently change the operational context on a driver's phone.
- Put one obvious primary action on each step. Preserve drafts when safe; give
  plain-language errors and a clear retry or recovery path.
- Keep labelled controls, visible keyboard focus, screen-reader announcements,
  large touch targets, scalable text and sufficient contrast. Test with assistive
  technology; a design specification is not an accessibility certification.
- Use local NGN formatting, explicit totals and familiar address/landmark entry.
  Customer Activity groups rides, food and parcels with service filters. Work and
  store activity use their own scoped views.
- Inbox groups conversations by trip/order/parcel and counterparty. Notifications
  include the service and intended mode. Opening a notification rechecks access
  and asks before changing context when work or an unsaved draft would be affected.

An active-activity strip stays reachable across modes, with "Return to trip" or
"Return to delivery" and the appropriate help action. Switching views does not
cancel a booking, erase an agreed fare or reset an order. Background permission
is requested for actual work, not merely because an account has a driver profile.

## Identity, permissions and business ownership

The schema-10 migration adds customer/driver capability grants while retaining
`users.role` for compatibility and explicit staff classification. Driver approval
stays separate. The following broader records remain the target conceptual model:

| Record | Responsibility |
| --- | --- |
| Account | Personal identity, authentication, contact preferences and account status |
| Service capability | An account's permission to drive passengers, deliver food or deliver parcels, with status and evidence |
| Worker profile and vehicle | Private onboarding, selected vehicle and service/vehicle eligibility |
| Vendor, store and membership | Business/store ownership plus owner, manager, kitchen or finance permissions |
| Session/device | Sign-in, revocation and ownership of active location/call leases |
| Activity | Service type, participants, assigned worker/vehicle, immutable agreement and versioned progress |
| Financial record | Customer purchase, worker earnings or store settlement, scoped to its owner |

A UI mode is a navigation preference. Every API operation must also check the
authenticated account, current capability status, store membership, ownership or
participant relationship, requested action and resource state. Deny unspecified
access. Recheck mutable permissions inside write transactions. These choices
follow [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

Client-supplied role, account, store or vehicle IDs are never proof of permission.
The server derives the actor from the session and validates any requested acting
context. A kitchen member can handle permitted order work without seeing payouts
or inviting other members. Revoked membership must stop future access even if an
old screen remains open. No automatic joining of accounts by name/phone: any
future duplicate-account consolidation needs proof of ownership and a reviewed
history-preserving process.

## Switching modes and protecting active work

Mode switching is independent of going Online/Offline. Availability remains
explicit, visible and server-owned. If a person is online without a job and wants
to leave Work mode, offer "Go offline and switch" and confirm the server result.
Until that succeeds, show the true pending/online state. Never claim a successful
offline transition based only on a lost connection.

During active work, keep the assigned activity, help entry point and tracking
status reachable. The existing trip/order state determines completion or
cancellation; the mode selector cannot do either. A mode change must not tear
down an active native tracking/call controller that still has valid consent and
ownership. Background operation is still subject to device permissions and OS
limits. Logout/revocation stops device-owned private processing; the activity
persists on the server with stale/unavailable status and a defined recovery path.

Define the first release's workload policy explicitly:

- One worker and selected vehicle can hold one reserved/active passenger or
  delivery job at a time across all services. No delivery batching initially.
  A transaction reserves capacity when work is accepted; concurrent acceptance
  on another device or in another service must lose safely.
- A person cannot fulfil their own customer request. Preserve the existing
  restrictions on overlapping passenger rides, negotiations and worker jobs.
  Being a customer in a reserved/active passenger journey and doing worker work
  are incompatible. Food/parcel purchases do not automatically make a buyer a
  worker or block an unrelated passenger journey.
- Receiving a purchase from one's own store and similar self-dealing rules need
  a separate operational policy; do not bypass payment/fraud controls by switching
  modes. Owning a staffed store does not itself occupy driver capacity.
- Service filters and vehicles can change only when there is no reserved/active
  job. A job retains its assigned vehicle and verified identity snapshot.
- Store opening and order-acceptance status are separate server commands. A
  member switching to Customer mode does not close the store or cancel orders.

Partition client caches, requests, drafts and retry keys by account, acting
context/store, service and resource ID. Increment a context generation before
loading a new mode; abort or discard older reads and clear private views. Commands
are bound to their original context and must not be retargeted or silently
replayed after a switch. Recheck permission when opening any saved/deep link.

## Modular implementation

Keep the existing modular monolith and explicit service boundaries. The unified
experience is a client shell over distinct business workflows. Do not stretch
the ride state machine to represent food preparation or parcel handover.

| Planned boundary | Responsibility |
| --- | --- |
| Accounts and access policy | Identity, sessions, capability projections and membership checks |
| Worker onboarding | Driver/rider evidence, vehicles, service-specific eligibility |
| Vendors | Stores, staff memberships, menus, availability and preparation |
| Rides | Requests, explicit fare agreement, passenger pickup and trip progress |
| Eats | Cart, price snapshot, stock reservation, order acceptance and refund policy |
| Courier | Parcel requirements, eligible vehicle, quote, custody and proof of delivery |
| Workload and dispatch | Cross-service worker/vehicle capacity and assignment through narrow ports |
| Payments, communications and safety | Shared infrastructure with service-specific authorization and records |
| Notifications | Durable delivery jobs, retry state and verified provider callbacks |

Add each module only when implementing its use cases. Retain current synchronous
transaction contracts until a separately verified storage change is necessary.
Use injected ports; do not have feature services import other repositories.
History can aggregate service summaries without merging their underlying state
machines. Personal spending, worker earnings and vendor settlement remain
separate views/records; one account does not create a transferable shared wallet.

Use one planned `apps/mobile/` React Native + Expo application with TypeScript,
feature folders and platform adapters. React Native recommends a framework such
as Expo for new apps; this is our proposed mobile implementation choice.
[React Native setup guidance](https://reactnative.dev/docs/environment-setup)

Keep the working HTML/CSS/JavaScript website in `apps/web/`. Share API contracts,
pure domain helpers, money formatting, design tokens and eligible client logic.
Native and browser views/adapters may differ. A shared product does not require
rewriting the website or making every component universal. Pin compatible
dependencies and record versions when the mobile foundation is implemented.

Before native integration, document/version the API request, response, error and
retry contracts and define a mobile session lifecycle. Preserve secure cookie
and CSRF controls for the website. Native authentication needs revocable
device-scoped sessions, reviewed refresh/expiry behaviour and secure credential
storage; a role value or local biometrics cannot grant server permissions.
Expo SecureStore supplies platform-protected storage on Android/iOS, but server
revocation and account recovery are still application responsibilities.
[Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)

The website supports the same business services and approved modes. GPS in the
background, incoming calls and notification delivery have platform differences.
For work requiring continuous location, readiness checks must require a capable
device with current permission/lease; offer continuation in the mobile app from
the web. Do not promise that a closed browser or killed app keeps reporting.
Native background location needs permission/configuration and physical-device
testing; Expo documents OS restrictions and development-build requirements.
[Expo Location](https://docs.expo.dev/versions/latest/sdk/location/#background-location)

## Reliability requirements

These are implementation and release gates, not claims about today's prototype.

| Failure or risk | Required behaviour |
| --- | --- |
| Repeated tap, timeout or lost response | Same command key returns the saved outcome; show Pending/Unknown until reconciled; no duplicate booking, order or charge |
| Stale offer, menu, stock or trip screen | Compare the exact version server-side; refresh and request any needed new consent |
| Concurrent devices/services | Atomically enforce ownership, workload, stock and transition constraints |
| Weak or lost connection | Show last-updated/stale state; keep minimal safe drafts; require server confirmation for acceptance, payment and job changes |
| Permission revoked or mode changed | Clear scoped private data, reject stale actions and preserve independent server activity |
| Push missed or duplicated | Refresh authoritative server state; deduplicate event handling; reconcile when the app opens/resumes |
| Provider outage or ambiguous payment | Persist delivery/payment attempts; use bounded retries and reconciliation; do not show false success |
| Process restart | Recover committed activities and pending notification work; replay safely without repeating side effects |
| Service problem | Disable affected new work through server-controlled service flags while preserving active-work recovery and other usable services |
| New app/backend version | Maintain a documented compatibility window and staged rollout; migrations preserve accounts, jobs and history |

External payment and notification work must run outside database transactions
using durable intent/outbox records, idempotent consumers and verified callbacks.
Assume messages may arrive late, more than once or out of order. Track attempts
and reconciliation; do not promise exactly-once external delivery.

Monitor critical journey failures, latency, crash-free sessions, stale tracking,
worker conflicts, stuck orders and payment/notification reconciliation. Agree
measurable service targets and expected pilot load by city before launch; do not
invent a reliability percentage. Exercise backup restoration, load limits,
dependency outages and recoverable deployment failure. Module boundaries do not
isolate every outage within the current single process/database.

Optimize for representative Nigerian devices and networks: compact responses,
paginated lists, compressed assets, feature loading and adaptive refresh. Keep
active work legible during weak connectivity. Minimize sensitive data in local
caches, logs and notification previews; scope telemetry to diagnostic needs.

## Safety, payments and AI

Preserve the exact fare offer/version and the other participant's acceptance.
In-app voice or chat can discuss a price; only explicit structured agreement
changes it. Keep phone numbers private in participant communications. Eats
prices/totals are agreed at checkout. Courier negotiation remains undecided.

Active rides/deliveries need a persistent safety/help path independent of the
selected mode. Incident data must name the correct activity, worker, vehicle and
timestamped available location. The existing SOS delivery is simulated; real
contact delivery and staffed escalation must be separately integrated and tested.
Automatic crash detection remains future evaluated native work.

Adaptive AI can later assist search, support, fare suggestions and reviewed risk
signals. Scope agent tools to the authenticated person, store and service. Agents
must not grant roles, accept fares, authorize payments or promise emergency
response. AI failure must leave manual booking, explicit agreement and help
usable. Evaluate suggestions and fallback behaviour before enabling adaptation.

## Implementation order and acceptance

1. **Account foundation and unified web navigation.** Implement multi-capability
   accounts, additive migration, permission checks and a context-aware web shell.
   Keep current ride flows operational. The first deliverable lets one eligible
   person use Customer and Work modes without a second login, without self-claim
   or cross-context data leaks. Vendor/delivery actions remain unavailable until
   their business modules exist.
2. **One mobile application.** Create `apps/mobile/`, secure native sign-in,
   navigation, API adapters and customer/worker ride flows. Layout work may start
   alongside step 1; connected feature delivery follows the access/API contract.
   Test iOS, Android and tablets from the first runnable build. Use development
   builds for native integrations; do not mistake a web preview for device QA.
3. **Courier and shared delivery work.** Add parcel details/vehicle limits,
   cross-service capacity, custody, delivery proof and cancellation/recovery.
   Decide pricing before implementing the checkout/negotiation contract.
4. **Taxi Ai Eats and My store.** Add store onboarding, memberships, menus, stock,
   customer checkout, preparation, food-delivery handover and settlement. Connect
   delivery through the shared workload boundary. Each enabled service must have
   an end-to-end operational flow, not just a service tile.
5. **Private pilot gates.** Hosting, real provider test environments, identity and
   recovery operations, network/device tests and staffed safety/support precede
   real passengers or purchases. Alibaba account setup remains paused; local
   development can continue. Review the existing PR stack before a release.
6. **Evaluated intelligence and later services.** Add bounded AI using evidence
   and monitoring. Autonomous taxis remain Coming soon without a launch date.

Steps 3 and 4 can be reprioritized, but Eats delivery depends on the shared worker
capacity and delivery contract. Production hardening runs alongside implementation;
it is not a task deferred until after public launch.

The migration must preserve IDs, password hashes, orders/trips, messages, fares,
receipts, review evidence and safety history. Map existing customer/driver grants
without inventing approval; expired/pending drivers stay ineligible for new work.
Keep staff privilege explicit. Existing drivers may use personal Customer mode
after the migration, subject to the same workload checks. Use a documented
compatibility/cutover strategy; never repurpose the old role column in place or
edit already-used migrations. Do not silently invalidate or recreate all accounts.

Required acceptance scenarios include:

- One account books as a customer and, when idle/eligible, works as a driver.
- A motorcycle courier cannot accept a passenger-car request.
- A worker cannot fulfil their own request or claim ride and parcel work at once.
- A store member cannot read another store's orders or exceed assigned duties.
- Switching modes/stores during slow responses never displays prior private data
  or sends queued commands using the new context.
- Switching mode during active work preserves the job, safety entry point and
  appropriate tracking ownership. Revocation/logout stops unauthorized access.
- Web and mobile agree on saved state after restart, reconnect and duplicate taps.
- Existing prototype accounts/history survive migration with equivalent limits.
- Phone/tablet/desktop navigation, accessibility, low connectivity and platform
  background behaviour are validated on actual target devices.

Open business decisions include courier rates, commissions/refunds, launch zones,
vehicle/parcel limits, vendor fulfilment capacity, store staffing, provider
selection and operating targets. They do not prevent the account/navigation
foundation, but their dependent workflows must stay disabled until defined.

## Implementation update — mobile foundation

The initial account and native foundations are implemented. Native sign-in,
Customer/Work navigation, own saved activity and driver enrollment/status share
existing accounts with web. Native booking, location/media, Eats, courier and
vendor operations remain later work. See [the native contract](mobile-foundation.md).
A separate [staff dashboard](admin-dashboard.md) now provides account profiles,
trip history, fare/payment totals and analytics at `/admin`. It is outside the
public app mode switcher. Dedicated staff sessions, MFA and scoped roles remain
requirements before the live pilot.
