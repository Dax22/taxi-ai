# Taxi Ai web preview

From the repository root, run `npm run dev`, then open http://localhost:3000.
Node.js 22.12+ works; no dependency installation is required. Press Ctrl+C to stop.

The website uses original Taxi Ai copy, the selected yellow forward-motion logo,
and an amber/graphite palette on pale backgrounds. See the
[brand guide](../../docs/brand.md) for colour values and logo assets. The spacious
layout follows the supplied design reference. The two car images are AI-generated concept artwork
from the earlier Taxi Ai design exploration, encoded as WebP for this project.
They do not depict an operational fleet or an available autonomous service.

## Working interactions

- Ride, Eats and Courier tabs, including arrow-key navigation.
- Sample Abuja pickup/destination selection, route swap and duplicate-area validation.
- A clearly labelled fictional fare suggestion.
- Customer/driver role switching in one local demonstration.
- Explicit offers, counteroffers, acceptance, expiry and cancellation through
  the shared domain module. Suggestions never become accepted fares by themselves.
- A final agreed-fare view with an offer history.
- Native modal keyboard handling, semantic labels, visible focus and reduced-motion CSS.

Eats/courier ordering, actual driver matching, maps, communication and payments
are not connected. Service tabs explain this; no buttons claim to book those
services. The source includes phone, tablet and desktop breakpoints.

## Local implementation

`server.mjs` serves an explicit allowlist of public files plus the shared domain
modules. It listens on `127.0.0.1`, has no writable endpoints and never serves
arbitrary repository files. `PORT=3001 npm run dev` selects a different local port.

All demo state lives in the browser memory. There is no local storage, telemetry,
real identity or network submission. Closing the dialog or refreshing resets the
demonstration. A production backend must authenticate actors and enforce all fare
and booking invariants server-side before this becomes a real service.

## Validation and manual browser review

`npm test` covers the domain rules, decimal-money parsing, sample-route validation
and HTTP asset serving/access boundaries. All 25 tests pass on Node.js 22.12.0 and
24.19.0. Source syntax checks also pass.

Visual and interactive browser verification is outstanding: the available cloud
browser blocked access to both the local server and the local file preview.
These tests do not establish cross-browser layout or accessibility compliance.

When reviewing locally:

1. Check the landing page at 390px, 768px and 1440px widths for clipping or overflow.
2. Select the same pickup and destination; confirm that a clear error appears.
3. Open a Wuse II → Maitama demo. As customer, send 4500. Switch to driver and
   counter with 4700. Switch to customer and accept 4700. Confirm the result says
   no ride was booked and that both offers remain in history.
4. Confirm the offer sender cannot accept their own offer, and a two-minute-old
   offer cannot be accepted. Verify that cancellation and reopening work.
5. Use only the keyboard: reach the booking form, open the dialog, switch roles,
   enter an amount, close with Escape and check that focus returns to the page.
6. Check Eats/Courier service labels, future autonomous status and image loading.

See the [roadmap](../../docs/roadmap.md) for the next implementation milestone.
