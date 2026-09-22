# Taxi Ai

Rides, Taxi Ai Eats and courier delivery, starting in Abuja, Nigeria.

Target product: **one Taxi Ai mobile app and one website**, with the same account
and Customer, Drive & deliver and My store modes. A person can have multiple
approved capabilities. This direction is documented in the
[unified platform plan](docs/unified-platform.md). The first milestone is implemented:
one website account with Customer and Work modes for rides. The first iOS/Android
app now shares sign-in, profiles, booking, driver availability, fare negotiation,
chat and complete ride/delivery journeys. Taxi Ai Eats now adds restaurant browsing, checkout, My store and courier handovers as a test flow. See [Eats setup](docs/eats.md). See [unified accounts](docs/unified-accounts.md)
and [mobile setup](apps/mobile/README.md).

## What works today

The yellow Taxi Ai website now includes **local customer, driver and administrator
accounts** at `/app`. Customers choose an Abuja address or map pin, preview a road
route and request a test journey; an approved online driver near the pickup can
select the request, make offers and agree a fare with the customer from a separate
browser session. The customer can confirm a booking, and the driver can record
arrival, verify the pickup PIN, start and complete the test trip. Customers can then
simulate payment and view a saved receipt; drivers can check their earnings preview.
Trip Safety adds trusted contacts, private test SOS records, administrator review
and expiring trip links. Contact notifications are simulated; nothing is sent.
Accounts, requests, trip history and agreements survive refresh
and server restart. Dashboards refresh every three seconds while visible.

This is a **development prototype**, not a launched transport service.
Use test details. Fares are fictional examples and all requests are test requests.
Drivers can explicitly share their browser-reported location during a confirmed
test trip. There is no live dispatch or payment. Driver applications now store
private documents and recorded manual checks; external identity/licence verification
is not connected. Use fictional details and documents.

- One personal login, Customer/Work mode switching and optional driver enrollment.
- Taxi Ai Eats on web/mobile: restaurant menus, single-store carts, itemized test checkout,
  order history, My store and courier handover codes. [Try a food order](docs/eats.md).
- One native system-font policy across app text, inputs, navigation, web and admin.
- Native sign-in, Home/Activity/Work/Updates/Account navigation and device revocation.
- Native driver availability, job claiming, fare consent, chat, pickup/drop-off verification
  and a durable updates inbox, with optional Expo phone alerts. See [native journeys](docs/mobile-journeys.md).
- Native **Book a ride**: Abuja address search, route/fare review, shared ride requests,
  status recovery and pre-start cancellation. See [mobile booking](docs/mobile-booking.md).
- Optional Google sign-up/sign-in for web and native development builds, with
  explicit password-confirmed linking for existing accounts. Configure your own
  OAuth clients using [Google setup](docs/google-sign-in.md); it stays off until configured.
- Email verification and password reset requests on web/mobile; secure email links
  complete on the responsive website. Delivery stays off until SMTP is configured.
  See [account email setup](docs/account-email.md).
- Web/mobile vehicle registration with make/year/model/colour dropdowns, years from
  2000 onwards, dependent models and custom entries for unlisted vehicles.
- Dropdowns start at **Apply to drive** on web. The chosen car and colour preview
  carry into the full application, including when continuing on mobile.
- Full mobile driver applications: vehicle details, private documents and submission
  into the existing manual review workflow.
- Rounded 3D-style car icons in ten colours, readable plates and approved vehicle
  identity on web/native journey cards; the web map keeps its explicit GPS consent.
  Exact-model 3D renders remain a separate catalogue milestone.
  See [vehicle identity](docs/vehicle-identity.md).
- Website Download app section stays Coming soon until real store URLs are added.
- Separate [operations dashboard](apps/admin/README.md) at `/admin`: searchable accounts,
  individual profiles, complete paginated trip history, exact fare/payment totals and analytics.
- Additive schema-13 reporting indexes preserve existing accounts, sessions and trip history.
- Server-checked trip roles, self-claim prevention and conflicting-work protection.
- Private driver applications, contact/licence/vehicle details and bounded image uploads.
- Administrator approval, rejection and corrections with recorded manual checks and review history.
- Current-document eligibility for new work, and stable driver/vehicle snapshots in trip history.
- Explicit Online/Offline availability, nearby matching and five-minute request expiry.
- GPS search expands from 5 km to 10 km after one minute; local sample-area matching
  supports testing outside Abuja without using device location.
- Persistent SQLite data, password hashes and revocable sessions.
- One open request/active trip per customer and one negotiation/active trip per driver.
- Explicit booking confirmation, driver progress, pickup PIN verification and completion.
- Cancellation reasons, saved trip activity and paginated completed/cancelled/expired history.
- Server-checked offers, counteroffers, two-minute expiry and explicit acceptance.
- Atomic writes, version checks, retry protection and an internal audit log.
- Private customer/assigned-driver chat with saved messages, unread counts and
  fare cards; reported messages appear in the local administrator dashboard.
- In-app audio call controls: call, answer, decline, mute, hang up and recent
  call history. Local WebRTC preview with an optional TURN relay adapter.
- Opt-in Abuja address search, map pins, road distance and estimated driving time.
- Saved route quotes with an illustrative fare formula; explicit negotiation still
  determines the final fare. Quotes expire after 15 minutes.
- Permission-based driver GPS for assigned participants, with explicitly created
  private trip links and incident snapshots extending its limited visibility; stale
  indicators and cleanup on stop, session expiry and trip closure.
- Optional private staging mode with an HTTPS gateway, invited tester access,
  secure cookies, operational health/logging and backup/restore commands.
- Local simulated payments at the exact agreed fare, saved printable receipts,
  driver gross-fare/paid/outstanding totals and administrator payment records.
- A repeatable full HTTP journey check, with session-isolated dashboard refreshes
  and protection against delayed responses/actions after an account change.
- Private test SOS with recorded driver ID, plate and available timestamped location.
- Trusted contacts, administrator incident acknowledgment/closure and local simulated
  notification delivery/retries; no messages to contacts, police or emergency services.
- Expiring, revocable trip links with limited details and access ending on sign-out
  or trip closure; contacts and incidents stay private.
- The original in-browser fare demo and terminal example remain available.

**Still planned:** production calling, verified identity and driver
documents, production mapping/tracking, actual dispatch, real payment-provider integration and payouts,
staff recovery/MFA, live safety notifications and staffed emergency response, production food/vendor
operations and settlements, AI estimators and app store releases. Autonomous taxis remain **Coming soon**, with no launch date.

## Run in VS Code

Use Node.js **22.12 or later**; `.nvmrc` selects Node 24 for new setups. Open the
repository folder, then use **Terminal → New Terminal**:

```bash
node --version
npm ci
npm run verify
npm run dev
```

Open **http://localhost:3000/app** for accounts or **http://localhost:3000** for the
website. Keep the terminal running. Press **Ctrl+C** to stop it. If port 3000 is
busy, use `PORT=3001 npm run dev` and open http://localhost:3001/app.

Install the locked server dependencies once with `npm ci` and after dependency
updates. Email/password preview needs no paid service or API key; optional Google
login needs your own OAuth credentials. The scripts enable Node's built-in SQLite
API, including the flag required by Node 22.12. A SQLite
experimental warning on that version is expected.

To check the complete customer/driver/administrator journey using disposable
test accounts and storage, run `npm run test:journey`. This includes simulated
payments, lost-response retries and restart recovery; it does not alter your
normal database or use real providers. See [pilot preparation](docs/pilot-readiness.md)
for the verified scope and remaining browser/device checks.

Online maps use public Photon search, OSRM routing and OpenStreetMap street tiles
after you click **Enable online maps**. These services need an internet connection
and have usage limits and no availability guarantee. They are suitable only for
this low-volume preview; production needs dedicated provider capacity. Use
`TAXI_AI_MAPS_MODE=off npm run dev` for the original sample-area demo without online
maps. See [the location guide](docs/locations.md) for provider configuration,
privacy, coverage and the manual review checklist.

## Set up the first administrator when needed

This can wait while you work on the code and homepage demo. A Taxi Ai business
mailbox is not required for development. Complete this setup when you want to
test driver approval and a full customer/driver negotiation.

1. At `/app`, create a **separate customer account** for the administrator. Choose
   your own email and password; there are no default accounts or passwords.
2. Before that account creates any rides, open a second VS Code terminal and run
   the following, replacing the example email with the one you just registered:

   ```bash
   npm run admin -- your-admin-email@example.com
   ```

3. Sign in again. That account now has the driver-approval dashboard. The command
   revokes its old sessions and works only when no administrator exists yet.
4. Create a personal account in another browser session, select **Apply to drive**,
   and add a fictional car model/plate. In Work, complete **Your driver application**,
   upload the five fictional documents and click **Submit for review**.
5. In the administrator dashboard, open **Review application**, download and inspect
   every file, record the manual checks/reference/reason, then choose **Record approval**.
   See [the onboarding guide](docs/driver-onboarding.md) for corrections and renewals.

The administrator role cannot be selected during registration or granted through
an HTTP endpoint. Additional administrators and staff account recovery are not built yet.
Customer/driver password recovery is available once [email delivery](docs/account-email.md) is configured.

## Try a complete customer/driver journey

1. Register a separate **customer** account. Click **Enable online maps**, search
   for pickup/destination landmarks or place pins, then **Preview route and
   suggested fare** and **Request this test ride**. Alternatively use the
   **Sample-area demo** for Wuse II → Maitama without an external service.
2. Open a different browser/profile or one private window and sign in as the
   approved driver and select **Work**. Two ordinary tabs share a login; use separate sessions.
3. In **Your availability**, choose **Share location and go online** for a routed
   request, using an Abuja device near the pickup. For a local sample request,
   select the same sample pickup area and click **Go online in sample area**.
   Keep this driver page visible. Then select **Start negotiation** and offer ₦5,000.
   Claiming stops availability; trip location sharing remains a separate choice.
4. The customer counters with ₦4,700. The driver clicks **Accept ₦4,700**.
5. The customer reviews the driver/fare and clicks **Confirm test booking**.
   Only the customer sees the six-digit pickup PIN.
   The driver may now click **Share my location** in Journey map and allow browser
   location access. GPS must be within the Abuja preview area and accurate within
   200 metres. No location access starts automatically; Stop sharing stops the
   device watcher immediately. GPS controls work independently of online tiles.
6. The driver clicks **On my way**, then **I have arrived**, enters the customer’s
   PIN and starts the trip. The driver then clicks **Complete trip**.
7. In the customer’s completed trip, select **Start test payment**, then
   **Simulate failure**. Retry with a new attempt and choose **Simulate success**.
   Check the receipt in both accounts and the driver’s **Your earnings preview**.
8. Refresh and restart the server; fare, trip activity, chat, payment state and
   receipts remain. No vehicle is dispatched or real payment taken.

Before completing a test trip, try **Trip safety**: save a fictional trusted contact,
create a test SOS and open it in the administrator queue. Create a private trip
link and test revocation. Nothing is sent externally. See [Trip Safety](docs/safety.md)
for the complete workflow, privacy rules and manual review. `npm run test:safety`
runs its automated checks against disposable data.

Read [the payments guide](docs/payments.md) for controls, exact amounts, receipts,
driver totals and manual print/browser review.

Read [the matching guide](docs/matching.md) for local testing, permission, radius,
timeouts and manual validation. Read [the trip guide](docs/trips.md) for cancellation, pickup verification,
history, database migration and the manual review checklist.

Once a driver claims the request, its **Your conversation** panel opens. Send a
message, propose a fare with the structured form, or accept the current offer.
Typing agreement in a message does not set the fare. After completion or cancellation, saved
chat remains read-only. See [the chat guide](docs/chat.md) for reporting, unread
behaviour and a complete manual review checklist.

The **Talk in Taxi Ai** panel lets the assigned customer and driver call without
using phone numbers. Keep two separate browser/profile sessions open on this
computer, click **Call in app**, allow the microphone, then click **Answer** in the other
session. Use headphones to avoid feedback. A spoken agreement still needs an
explicit fare offer and acceptance in the app. Calls do not record or transcribe.
Follow [the voice guide](docs/voice.md) for setup, relay configuration and review.
Real browser audio, Safari/iOS/Android compatibility and relay operation have not
yet been verified; automated tests cover the lifecycle and media orchestration.

## Your local data

The database is created automatically at `data/taxi-ai.sqlite` inside this repo.
Keep that file and its SQLite sidecar files on your own computer. They are ignored
by Git and are never served by the website. Source code goes to GitHub; accounts,
password hashes and ride history do not.

`TAXI_AI_DB=/absolute/path/to/test.sqlite npm run dev` selects another database.
Use the same variable for `npm run admin` when using a custom path. Migrations run
automatically at startup. `npm run backup -- /absolute/new-backup.sqlite` makes a
validated copy without changing the source. See [staging and recovery](docs/staging.md)
for restore, transient-data removal, scheduling and off-host backup requirements.

The current schema is **19**: Trip Safety added schema 9, unified accounts added
schema 10, native device sessions added schema 11 and initial vehicle selections
add schema 12 in 0.17. This new table preserves the car chosen before full driver
details are complete without changing existing applications or approvals. Release
0.18 adds reporting indexes in schema 13 without rewriting records. Release 0.19
adds Google identity mappings, password eligibility and expiring login attempts
in schema 14. Release 0.20 adds email verification records, hashed action tokens
and durable email intentions in schema 15. Release 0.22 adds persisted vehicle
categories and delivery handover state in schema 16, preserving previous records
and command retry outcomes. Schema 17 adds native availability and notifications,
schema 18 vehicle photo checks, and schema 19 restaurant/menu/food-order records.
Backups retain private contact/incident
data, identity mappings and verification records while revoking trip links, sessions,
pending Google attempts, email links and queued mail. Restored backups never send old emails.

The earlier payment milestone upgrades schema 1–6 to 7 without resetting existing records
or automatically booking old agreements. Completed trips receive unpaid simulation
records; no successful payment or receipt is invented. Back up with the previous
release before starting the new release on saved data. Old unclaimed requests
receive a five-minute deadline and expire on the next sweep if already overdue. Earlier branches cannot
open the upgraded database; use a separate test database when comparing versions.

By default the server listens on **127.0.0.1** and accepts localhost origins.
The optional `TAXI_AI_MODE=staging` requires a configured HTTPS origin, private
gateway token, invited tester access file and explicit persistent database path.
It uses secure host-only cookies. The Docker/Caddy reference setup publishes only
the HTTPS gateway; the app port remains internal. No host, domain or cloud account
has been provisioned. Follow [the staging guide](docs/staging.md) to configure and
review a deployment; the Docker image deliberately refuses an incomplete setup.

## Project layout

| Path | Purpose |
| --- | --- |
| `apps/web/` | Website, responsive dashboards and local HTTP server |
| `apps/web/public/dashboard/` | Separate views, auth form, DOM helpers and API client |
| `services/api/src/application.mjs` | Connects services, repositories and adapters |
| `services/api/src/modules/accounts/` | Account/session services, repository and routes |
| `services/api/src/modules/drivers/` | Driver application/review services, repository and routes |
| `services/api/src/modules/rides/` | Ride/fare/trip services, domain rules, repository and routes |
| `services/api/src/modules/chat/` | Participant-only messages, unread cursors, retry keys and reports |
| `services/api/src/modules/calls/` | Call lifecycle, participant/window ownership and temporary audio signaling |
| `services/api/src/modules/locations/` | Saved route quotes, fare suggestions and driver location sharing |
| `services/api/src/modules/availability/` | Driver availability and matching leases |
| `services/api/src/modules/payments/` | Simulated attempts, receipts, driver totals and payment records |
| `services/api/src/modules/safety/` | Trusted contacts, private incidents, simulated alerts and expiring trip links |
| `services/api/src/http/` | Request parsing, routing, cookies and response mapping |
| `services/api/src/infrastructure/` | Database, password, token, audit and rate-limit adapters |
| `services/api/migrations/` | Versioned SQLite schema |
| `services/api/test/` | API, permissions, competing-request and restart tests |
| `packages/shared/` | Fare rules, trip lifecycle vocabulary, money helpers and sample-area fixtures |
| `scripts/create-admin.mjs` | Local first-administrator setup |
| `scripts/check.mjs` | Syntax, imports and module-boundary checks |
| `deploy/staging/` | Private Docker Compose/Caddy deployment configuration |
| `scripts/database-snapshot.mjs` | Checked backups/restores into new files |
| `scripts/staging-access.mjs` | Add/remove invited tester access keys |
| `.github/workflows/ci.yml` | Automated verification on Node 22.12.0 and 24 |
| `apps/mobile/` | Expo iOS/Android accounts, driver onboarding and customer ride requests |
| `docs/` | Requirements, architecture, roadmap and approved brand |

The backend is a **modular monolith**: business modules share one process/database
and communicate through explicitly supplied functions. HTTP and storage details
stay outside business services. Versioned migrations preserve existing accounts, sessions and rides.

The terminal example runs with `npm run demo`. Read [the architecture](docs/architecture.md),
[roadmap](docs/roadmap.md), [requirements](docs/requirements.md) and
[brand guide](docs/brand.md) for the product direction.

## Development and review

The latest development branch is `feat/eats-ordering`. Version 0.24.0 / mobile
0.8.0 adds Taxi Ai Eats and a shared system-font policy across app surfaces.
Schema 19 preserves existing records and adds stores, menus, reviews, checkout
quotes, food orders and retry records. See [Eats setup and acceptance](docs/eats.md)
and [mobile setup](apps/mobile/README.md). Back up the database before changing
branches; older releases may not support the existing schema.
Read [CONTRIBUTING.md](CONTRIBUTING.md) for the GitHub/VS Code workflow and where
new code belongs. `npm run check` validates syntax and module conventions;
`npm test` checks behaviour; `npm run verify` runs both. GitHub Actions is configured
to run verification on pushes and pull requests.
An additional container job validates Caddy configuration and tests protected
access, secure cookies, persistent restart, health and graceful shutdown.

Use a branch and pull request for changes. Saving in VS Code is local; commit and
push to upload changes to GitHub. Existing milestone branches hold work that has
not yet been merged into `main`. Never commit secrets or local account data.
No licence has been selected for this private project.

Browser visual and interaction review is still required: the available cloud
browser blocks local previews. Follow [the manual review steps](apps/web/README.md).
Live map-provider connectivity and real browser/device GPS remain unverified.
Automated tests use provider and device fixtures; driving time excludes live
traffic and driver arrival, and suggested fares are not AI or market estimates.
