# Taxi Ai web

Run `npm run dev` from the repository root, then open http://localhost:3000.
The **Your account** button opens `/app`. Node.js 22.12+ works; no dependency
installation or provider credentials are required.

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
only its loopback addresses. CSP permits same-origin scripts, styles, images and
API connections, with inline code and embedding disabled. Camera, microphone and
geolocation permissions remain disabled until their features are implemented.

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
4. Submit a customer request. In a second session, select it as the driver. Offer
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
   Chat, calls, payments and live dispatch must not appear as available actions.
