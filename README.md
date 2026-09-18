# Taxi Ai

Rides, Taxi Ai Eats and courier delivery, starting in Abuja, Nigeria.

## What works today

The yellow Taxi Ai website now includes **local customer, driver and administrator
accounts** at `/app`. Customers request a sample journey; an approved driver can
take the request, make offers and agree a fare with the customer from a separate
browser session. Accounts, requests, fare history and agreements survive refresh
and server restart. Dashboards refresh every three seconds while visible.

This is a **local development prototype**, not a launched transport service.
Use test details. Fares are fictional examples and all requests are test requests.
There is no live dispatch, payment or operational booking confirmation. Driver
approval grants test access; it does not verify identity or vehicle documents.

- Customer/driver registration and password sign-in, with separate dashboards.
- Pending driver applications, vehicle details and administrator approval.
- Persistent SQLite data, password hashes and revocable sessions.
- One open request per customer and one negotiation per driver.
- Server-checked offers, counteroffers, two-minute expiry and explicit acceptance.
- Atomic writes, version checks, retry protection and an internal audit log.
- The original in-browser fare demo and terminal example remain available.

**Still planned:** chat, private in-app voice calls, verified identity and driver
documents, maps/GPS, actual dispatch, trip-start PIN, payments/receipts, password
recovery, food/vendor ordering, motorcycle courier delivery, AI estimators and
native iOS/Android apps. Autonomous taxis remain **Coming soon**, with no launch date.

## Run in VS Code

Use Node.js **22.12 or later**; `.nvmrc` selects Node 24 for new setups. Open the
repository folder, then use **Terminal → New Terminal**:

```bash
node --version
npm test
npm run dev
```

Open **http://localhost:3000/app** for accounts or **http://localhost:3000** for the
website. Keep the terminal running. Press **Ctrl+C** to stop it. If port 3000 is
busy, use `PORT=3001 npm run dev` and open http://localhost:3001/app.

No `npm install`, paid service or API key is needed. The scripts enable Node's
built-in SQLite API, including the flag required by Node 22.12. A SQLite
experimental warning on that version is expected.

## Set up the first administrator

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
5. Both dashboards show the same saved agreement. Refresh both pages, then stop
   and restart the server. The agreement and history remain available.

These actions save a test fare agreement only. They do not dispatch a car.

## Your local data

The database is created automatically at `data/taxi-ai.sqlite` inside this repo.
Keep that file and its SQLite sidecar files on your own computer. They are ignored
by Git and are never served by the website. Source code goes to GitHub; accounts,
password hashes and ride history do not.

`TAXI_AI_DB=/absolute/path/to/test.sqlite npm run dev` selects another database.
Use the same variable for `npm run admin` when using a custom path. Migrations run
automatically at startup. There is no production backup/retention process yet.

The server listens on **127.0.0.1 only** and accepts its localhost origins. The
current HTTP cookies and authentication setup are for local development. Read
[the backend notes](services/api/README.md) before planning public hosting.

## Project layout

| Path | Purpose |
| --- | --- |
| `apps/web/` | Website, responsive dashboards and local HTTP server |
| `services/api/src/` | Accounts/sessions, permissions and persistent ride commands |
| `services/api/migrations/` | Versioned SQLite schema |
| `services/api/test/` | API, permissions, competing-request and restart tests |
| `packages/shared/` | Fare domain rules, money helpers and sample-area fixtures |
| `scripts/create-admin.mjs` | Local first-administrator setup |
| `apps/customer/`, `apps/driver/` | Native-app planning notes |
| `docs/` | Requirements, architecture, roadmap and approved brand |

The terminal example runs with `npm run demo`. Read [the architecture](docs/architecture.md),
[roadmap](docs/roadmap.md), [requirements](docs/requirements.md) and
[brand guide](docs/brand.md) for the product direction.

## Development and review

Use a branch and pull request for changes. Review the changed files, commit, and
push/sync from VS Code. Run `npm test` before pushing a milestone. Never commit
secrets or local account data. No licence has been selected for this private project.

Browser visual and interaction review is still required: the available cloud
browser blocks local previews. Follow [the manual review steps](apps/web/README.md).
