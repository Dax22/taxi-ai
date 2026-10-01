# Kemmy food and parcel updates

Kemmy sends saved delivery updates alongside the existing live map. Food orders
and courier parcels use the same web/mobile message contract. The customer sees
the updates; an authenticated parcel recipient also receives updates after
accepting the sender's tracking invitation. A food recipient's name or phone
number alone does not enroll another account or send an SMS.

## What triggers each message

| Milestone | Food | Parcel |
| --- | --- | --- |
| Picked up | Courier confirms collection with the kitchen's pickup code and fresh GPS | Driver starts the confirmed parcel job with the sender's pickup PIN and fresh GPS |
| Arrived | Courier confirms arrival at the delivery address | Driver chooses **Arrived at recipient** while the parcel is in progress |
| Delivered | Courier confirms the recipient's delivery code | Driver completes the job with the recipient's drop-off code |

The parcel driver's existing **Arrived** action still means arrival at the
sender's pickup point. The new destination-arrival action is separate. It keeps
the parcel in progress until the verified handover is complete. Existing clients
can still complete a parcel using its drop-off code without the new action.
Arrival is a courier confirmation with fresh GPS, not automatic geofencing.

The pickup message says that the food/package has been collected and, when
routing succeeds, that it should reach the recipient in approximately a number
of minutes. The estimate uses the courier's position at pickup and the saved
recipient destination through the configured backend road router. It excludes
live traffic and is labeled as an estimate at pickup, not a continuously updated
countdown. Live tracking continues independently. Missing coordinates, disabled
routing or an unavailable provider produce an explicit unavailable-ETA message;
Kemmy never substitutes a made-up speed or straight-line travel time.

## View and test

1. Update to the latest code, restart the backend and sign in as the customer
   and an approved courier on separate browsers or phones. PostgreSQL deployments
   must run `npm run db:postgres:migrate`; SQLite upgrades at startup.
2. Create a delivery food order or courier parcel. Complete any required test
   checkout. Use a saved map destination and configured road routing to exercise
   the numeric ETA; sample-only destinations may have no route estimate.
3. Start **Share my location** on the courier's active job, then confirm collection
   with the correct pickup code. Kemmy's card and the in-app delivery update should
   appear for the customer. A bounded background worker adds the route estimate.
4. At the destination choose the food arrival action or **Arrived at recipient**
   for a parcel. Kemmy reports arrival. Confirm the delivery code separately to
   produce the completed-handover message.
5. For parcel recipient testing, accept the sender's invitation while signed in
   to a separate customer account before pickup. Revoking or replacing that grant
   removes access to its updates and suppresses unsent phone alerts.
6. Refresh/retry the same courier command and restart the server. The saved
   milestone must remain single, and the tracking map must continue working.

Web pages show in-app banners and Kemmy cards. They do not request browser
notification permission or promise alerts after the browser is closed. Native
phone alerts reuse the existing Expo opt-in and signed device build setup in
[native journeys](mobile-journeys.md#optional-phone-alerts). Enable phone alerts
in **Updates** and allow the device permission. Native Updates also keeps an inbox
when push is disabled. Delivery alerts reuse the existing journey notification
channel and its permission settings. Rebuild the native app to include the new
delivery screens and notification navigation.

## Implementation and delivery limits

`delivery-updates` owns durable milestone rows and leased push jobs. Food and
parcel state changes create their updates within the same database transaction;
failed PINs, failed saves and exact command retries cannot create extra milestones.
Routing and push requests run outside that transaction. A unique account/target/
phase key protects the inbox, while jobs recheck the device opt-in and recipient
access before sending. Obsolete queued pickup/arrival alerts are suppressed after
the next milestone. Provider retries can still result in a repeated phone alert
if a successful provider response is lost; push delivery is not exactly once.

Messages and push routing contain no kitchen origin, recipient phone, address,
handover code or route geometry. Temporary route coordinates are cleared after
ETA processing. Push data contains only the delivery update ID; opening it checks
the current signed-in account and grant before returning a navigation target.

The authenticated APIs are `GET /api/delivery-updates`,
`GET /api/delivery-updates/:kind/:targetId`, and
`POST /api/delivery-updates/:updateId/open`. Native equivalents use
`/api/mobile/v1/delivery-updates`. List cursors and notice IDs are UUIDs, separate
from the older numeric ride-notification IDs.

Automated provider tests do not establish real APNs/FCM delivery or validate your
routing deployment. Finish pickup, arrival, background/locked-phone alerts and
wrong-account notification taps on the two physical test phones before rollout.
