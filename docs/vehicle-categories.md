# Vehicle categories and booking workflows

Release 0.22 / mobile 0.6 enables all five categories in the development preview.
The SUV artwork retains the user's silver Cybertruck; van, truck and motorcycle
use matching white illustrations. Artwork never guarantees a particular model,
paint or fleet. Check the assigned driver's approved vehicle and plate.

| Category | Booking | Preview fare factor | Preview maximum parcel weight |
| --- | --- | --- | --- |
| Standard | Passenger ride | 1× | Not applicable |
| SUV | Passenger ride | 1.5× | Not applicable |
| Van | Parcel delivery | 1.8× | 500 kg |
| Truck | Cargo delivery | 3× | 3,000 kg |
| Motorcycle | Food or small-parcel delivery | 0.7× | 20 kg |

Factors and weights are illustrative preview policies, not market prices,
manufacturer capacities or regulatory limits. A delivery must also fit the
specific driver's manually reviewed load capacity. Sender and driver confirm
physical size, loading needs and access before collection. Passenger motorcycle
rides and restaurant ordering are outside this workflow.

## Customer and courier flows

1. Select a category on the website or native Home/booking screen. Web home
   offers a category-priced sample fare negotiation and a link to `/app` for
   saved bookings. Native Home passes the category into booking.
2. For deliveries, enter parcel description/size, total weight and recipient name;
   pickup/drop-off instructions are optional. These fields remain private to the
   sender and assigned driver. The preview does not contact the recipient.
3. Preview locations and the category's suggested fare. Standard/SUV retain car
   routing. Deliveries use a clearly labelled **straight-line distance**, with no
   driving route or ETA; the existing car router is not a courier navigation provider.
   Sample-area requests remain local-development-only.
4. Submit the request. Only online, eligible drivers in the exact approved
   category and with sufficient approved capacity see or claim it. Nearby lists
   do not contain parcel descriptions, recipient details or codes.
5. Both participants explicitly agree a fare, then the customer confirms the
   booking. Category/capacity are checked again at confirmation and collection.
   Native requests share the web queue; negotiation and driver trip controls
   continue on the website with the same account.
6. The driver marks departure/arrival and verifies the sender's pickup PIN after
   collection. The sender can then see a separate drop-off code and share it
   privately with the recipient. Only the assigned driver can complete delivery,
   by entering that code at handover. Passenger rides keep their existing completion.
7. Five incorrect drop-off attempts lock verification for five minutes. Retrying
   the same failed command does not spend another attempt. Verification, completed
   status, history and the unpaid simulated fare record commit in one transaction.
   Codes clear on completion or pre-collection cancellation.

Changing category invalidates saved/pending quotes. The server binds every quote
to its category, owner and expiry. Native uncertain writes retain the exact
category, parcel payload and retry key. Account/mode reset clears private drafts
and displayed codes. Existing bookings retain their category and vehicle snapshot.

## Vehicle application and approval

Web Apply to drive, full web applications and native applications capture category
and delivery capacity. Existing required documents and manual approval remain in
place; review now explicitly includes category and capacity. Reopening removes
new-work eligibility. Applications cannot change during assigned work. Legacy
approved vehicles without a category remain Standard; the migration does not
invent SUV/courier approval.

## Architecture and migration

- `transport-categories.mjs` owns pure service, pricing and payload rules; the
  visual catalogue and bundled artwork remain separate.
- The existing journey engine owns request, matching, negotiated fare, pickup,
  progress, cancellation and history. API paths remain `/api/rides` and native
  `/booking/requests`, with `vehicleCategory` and optional `delivery` fields.
- A separate `deliveries` module owns validated parcel metadata and handover
  verification, exposed to the journey engine through injected ports.
- Schema 16 adds `rides.vehicle_category` (legacy default Standard) and
  `delivery_orders`. It atomically copies existing idempotency rows into an
  equivalent table with a broader error constraint for drop-off failures; keys,
  fingerprints and previous pickup-PIN errors are preserved.
- Vehicle category/capacity use the existing reviewed application JSON. Accounts,
  approvals, fares, sessions and past trip snapshots are retained. Backups require
  schema 16 and retain delivery state so restored journeys can resume after login.
- Category and vehicle identity appear in participant history and staff reporting.
  Staff reports, unclaimed queues and public trip shares do not expose parcels or
  handover codes. Static resources remain explicitly allowlisted.

## Verification and acceptance

Run `npm run verify` and `npm run mobile:verify`. Automated coverage includes every
category's full journey, legacy migrations, category/capacity gates, quote/category
mismatch, direct-distance routing, private projections, PIN lockout/replay/restart,
completion rollback, cancellation, mobile payload recovery and web account reset.
Both native platform exports are build checks, not physical-device acceptance.

Manual browser/device and screen-reader acceptance remains pending. The available
browser blocked the local preview with `ERR_BLOCKED_BY_CLIENT`; layout is not
claimed as browser-verified. Check phone/tablet widths, large text, keyboard category
navigation, recipient form validation and the two handover participants. No
production deployment, live dispatch/payment or app-store release is included.

See [artwork provenance and prompts](design/vehicle-categories.md).
