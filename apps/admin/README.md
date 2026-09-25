# Taxi Ai Operations

The separate, responsive staff application at `/admin` is served
by the existing server. It reads the same accounts, applications, journeys and
simulated payments used by the website and native app. No separate install is needed.

## Open it locally

1. Run `npm run dev` from the repository root.
2. If there is no administrator yet, register a separate customer account at
   `/app`, then run `npm run admin -- your-admin-email@example.com` using that
   account's email. The command only establishes the first administrator and uses
   the configured database. It does not promote a driver or an account with rides.
3. Open `http://localhost:3000/admin` and sign in with that administrator account.
   Existing administrators can go directly to this step.
4. Select **Accounts**, then a name or **View account**. Browse every saved trip,
   separate personal spending and driving fares, and the current vehicle application.
5. Existing administrators have the **Owner** staff role. Under **Staff**, assign
   registered accounts Operations, Support, Safety or Finance access with a reason.
   The affected staff member signs in again after a role change.

Ordinary browser tabs share the website login. Use a separate browser profile or
private session when testing staff and customer accounts simultaneously.

If you forget the existing administrator password, stop the local server and run
`npm run admin:reset-password -- your-admin-email@example.com` in the VS Code
terminal. Enter and confirm a new password when prompted; input stays hidden.
Restart the server and sign in again. The reset preserves accounts, trips, staff
roles and enrolled authenticators, and signs out old sessions. See the
[operator recovery instructions](../../docs/admin-workspace.md#forgotten-administrator-password).

## Pages

| Path | Purpose |
| --- | --- |
| `/admin` | Period summary, daily journey activity, account counts and recent trips |
| `/admin/accounts` | Search name/email/account ID/plate; filter customer-only or driver accounts and review state |
| `/admin/accounts/:id` | Audited profile read, vehicle, lifetime passenger/driving totals and paginated history |
| `/admin/trips` | Search and filter all journeys by status, payment and request date |
| `/admin/trips/:id` | Audited trip read, participants, saved vehicle, agreed fare, payment reference and timeline |
| `/admin/analytics` | Nigeria date ranges (WAT), daily charts and tables, outcomes, completion/cancellation rates and top routes |
| `/admin/operations` | Waiting rides, active journeys, available drivers, delayed Eats orders and matching measurements |
| `/admin/cases` | Permission-scoped support and safety queues, assignment and response targets |
| `/admin/cases/:id` | Notes, priority, status, history and restricted linked trip/incident evidence |
| `/admin/staff` | Owner-managed staff roles and session revocation |
| `/admin/audit` | Searchable staff access and recorded administrative actions |

All pages support direct links, normal browser navigation and refresh. Keyset
pagination includes old trips beyond the customer workspace's shorter list.
The directory masks email addresses; opening a profile records staff access and
shows the contact email. No private documents, licence numbers, passwords, PINs,
raw GPS, conversations or call recordings are returned by reporting APIs.
Finance sees aggregate analytics only. The separate safety case API can show a
saved incident location with its timestamp; that snapshot is not a live GPS feed.
Navigation and server permissions both restrict the available pages by role.

## Modules and verification

- `public/api-client.mjs`: same-origin cookie transport, CSRF and timeout handling.
- `public/controller.mjs`: verified staff identity, refresh, sign-out and stale-read protection.
- `public/navigation.mjs`: routes, titles and deep links.
- `public/pages.mjs`: page composition; `ui.mjs` and `charts.mjs`: text-only components,
  exact money formatting, accessible chart values and responsive presentation.
- `services/api/src/modules/admin-console/`: staff authorization, filter/date rules,
  audited reads and a separate SQL reporting projection. Existing business services
  continue to own approvals, trips and payments.
- `npm run verify`: root suite includes staff API, controller, DOM and migration tests.

Payment totals are explicitly simulations. Completed fares are gross fares, not
platform revenue, settlements or driver payouts. Analytics uses request date
cohorts in Africa/Lagos; profile totals remain all time even when history is filtered.
See [metric definitions and release boundaries](../../docs/admin-dashboard.md).

Staff membership is separate from customer/driver capabilities. Browser sessions
are still shared with the main website. Configure a persistent
`TAXI_AI_STAFF_MFA_KEY` (64 hexadecimal characters) and set
`TAXI_AI_STAFF_MFA_REQUIRED=true` before requiring authenticator enrollment.
Once enrolled, staff must verify even if the deployment setting is optional.
See [roles, MFA setup and case workflows](../../docs/admin-workspace.md).
Dedicated staff sessions/origin and operational readiness remain deployment work.
Browser/device visual acceptance remains pending; DOM tests do not establish
layout or accessibility on an actual browser.
