# Taxi Ai Operations

Release 0.18 provides a separate, responsive staff application at `/admin`, served
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

Ordinary browser tabs share the website login. Use a separate browser profile or
private session when testing staff and customer accounts simultaneously.

## Pages

| Path | Purpose |
| --- | --- |
| `/admin` | Period summary, daily journey activity, account counts and recent trips |
| `/admin/accounts` | Search name/email/account ID/plate; filter customer-only or driver accounts and review state |
| `/admin/accounts/:id` | Audited profile read, vehicle, lifetime passenger/driving totals and paginated history |
| `/admin/trips` | Search and filter all journeys by status, payment and request date |
| `/admin/trips/:id` | Audited trip read, participants, saved vehicle, agreed fare, payment reference and timeline |
| `/admin/analytics` | Nigeria date ranges (WAT), daily charts and tables, outcomes, completion/cancellation rates and top routes |

All pages support direct links, normal browser navigation and refresh. Keyset
pagination includes old trips beyond the customer workspace's shorter list.
The directory masks email addresses; opening a profile records staff access and
shows the contact email. No private documents, licence numbers, passwords, PINs,
raw GPS, conversations or call recordings are returned by reporting APIs.

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

The preview uses the existing web administrator role and session. Dedicated staff
sessions/origin, MFA and granular support/finance permissions remain prerequisites
for a public pilot. Browser/device visual acceptance remains pending; DOM tests
do not establish layout or accessibility on an actual browser.
