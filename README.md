# Taxi Ai

Rides, Taxi Ai Eats and courier delivery, starting in Abuja, Nigeria.

## What works today

The yellow Taxi Ai website now includes **local customer, driver and administrator
accounts** at `/app`. Customers request a sample journey; an approved driver can
take the request, make offers and agree a fare with the customer from a separate
browser session. The customer can confirm a booking, and the driver can record
arrival, verify the pickup PIN, start and complete the test trip.
Accounts, requests, trip history and agreements survive refresh
and server restart. Dashboards refresh every three seconds while visible.

This is a **local development prototype**, not a launched transport service.
Use test details. Fares are fictional examples and all requests are test requests.
There is no live dispatch, GPS tracking or payment. Driver
approval grants test access; it does not verify identity or vehicle documents.

- Customer/driver registration and password sign-in, with separate dashboards.
- Pending driver applications, vehicle details and administrator approval.
- Persistent SQLite data, password hashes and revocable sessions.
- One open request/active trip per customer and one negotiation/active trip per driver.
- Explicit booking confirmation, driver progress, pickup PIN verification and completion.
- Cancellation reasons, saved trip activity and paginated completed/cancelled history.
- Server-checked offers, counteroffers, two-minute expiry and explicit acceptance.
- Atomic writes, version checks, retry protection and an internal audit log.
- Private customer/assigned-driver chat with saved messages, unread counts and
  fare cards; reported messages appear in the local administrator dashboard.
- In-app audio call controls: call, answer, decline, mute, hang up and recent
  call history. Local WebRTC preview with an optional TURN relay adapter.
- The original in-browser fare demo and terminal example remain available.

**Still planned:** production calling, verified identity and driver
documents, maps/GPS, actual dispatch, payments/receipts, password
recovery, food/vendor ordering, motorcycle courier delivery, AI estimators and
native iOS/Android apps. Autonomous taxis remain **Coming soon**, with no launch date.

## Run in VS Code

Use Node.js **22.12 or later**; `.nvmrc` selects Node 24 for new setups. Open the
repository folder, then use **Terminal → New Terminal**:

```bash
node --version
npm run verify
npm run dev
```

Open **http://localhost:3000/app** for accounts or **http://localhost:3000** for the
website. Keep the terminal running. Press **Ctrl+C** to stop it. If port 3000 is
busy, use `PORT=3001 npm run dev` and open http://localhost:3001/app.

No `npm install`, paid service or API key is needed. The scripts enable Node's
built-in SQLite API, including the flag required by Node 22.12. A SQLite
experimental warning on that version is expected.

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
4. Register a driver account in another browser session. In the administrator
   dashboard, review the application and click **Approve**.

The administrator role cannot be selected during registration or granted through
an HTTP endpoint. Additional administrators and account recovery are not built yet.

## Try a complete customer/driver journey

1. Register a separate **customer** account. Choose Wuse II → Maitama and click
   **Request a test ride**.
2. Open a different browser/profile or one private window and sign in as the
   approved driver. Two ordinary tabs share a login; use separate sessions.
3. The driver selects **Start negotiation** and offers ₦5,000.
4. The customer counters with ₦4,700. The driver clicks **Accept ₦4,700**.
5. The customer reviews the driver/fare and clicks **Confirm test booking**.
   Only the customer sees the six-digit pickup PIN.
6. The driver clicks **On my way**, then **I have arrived**, enters the customer’s
   PIN and starts the trip. The driver then clicks **Complete trip**.
7. Check Trip history in both accounts. Refresh and restart the server; saved
   fare, trip activity and chat remain. No vehicle is dispatched or payment taken.

Read [the trip guide](docs/trips.md) for cancellation, pickup verification,
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
automatically at startup. There is no production backup/retention process yet.

The voice milestone upgrades the database from schema 1, 2 or 3 to 4 without resetting
existing records or automatically booking old agreements. Earlier branches cannot
open the upgraded database; use a separate test database when comparing versions.

The server listens on **127.0.0.1 only** and accepts its localhost origins. The
current HTTP cookies and authentication setup are for local development. Read
[the backend notes](services/api/README.md) before planning public hosting.

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
| `services/api/src/http/` | Request parsing, routing, cookies and response mapping |
| `services/api/src/infrastructure/` | Database, password, token, audit and rate-limit adapters |
| `services/api/migrations/` | Versioned SQLite schema |
| `services/api/test/` | API, permissions, competing-request and restart tests |
| `packages/shared/` | Fare rules, trip lifecycle vocabulary, money helpers and sample-area fixtures |
| `scripts/create-admin.mjs` | Local first-administrator setup |
| `scripts/check.mjs` | Syntax, imports and module-boundary checks |
| `.github/workflows/ci.yml` | Automated verification on Node 22.12.0 and 24 |
| `apps/customer/`, `apps/driver/` | Native-app planning notes |
| `docs/` | Requirements, architecture, roadmap and approved brand |

The backend is a **modular monolith**: business modules share one process/database
and communicate through explicitly supplied functions. HTTP and storage details
stay outside business services. Versioned migrations preserve existing accounts, sessions and rides.

The terminal example runs with `npm run demo`. Read [the architecture](docs/architecture.md),
[roadmap](docs/roadmap.md), [requirements](docs/requirements.md) and
[brand guide](docs/brand.md) for the product direction.

## Development and review

The latest development branch for this milestone is `feat/in-app-voice`.
Read [CONTRIBUTING.md](CONTRIBUTING.md) for the GitHub/VS Code workflow and where
new code belongs. `npm run check` validates syntax and module conventions;
`npm test` checks behaviour; `npm run verify` runs both. GitHub Actions is configured
to run verification on pushes and pull requests.

Use a branch and pull request for changes. Saving in VS Code is local; commit and
push to upload changes to GitHub. Existing milestone branches hold work that has
not yet been merged into `main`. Never commit secrets or local account data.
No licence has been selected for this private project.

Browser visual and interaction review is still required: the available cloud
browser blocks local previews. Follow [the manual review steps](apps/web/README.md).
