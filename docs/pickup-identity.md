# Vehicle changes and pickup identity

## Change the registered vehicle

On web and native, open **Work → Your Work profile → Edit / change vehicle**.
Native also shows the same controls in **Account**; the web account shortcut opens
Work. Drafts open the vehicle fields directly. Submitted or approved applications
ask for confirmation before reopening and pausing new jobs. Update make, model,
year, colour, number plate, category and applicable load capacity, then save.
Saving changed vehicle details removes the current vehicle photo, registration
and insurance files. Upload replacements for that vehicle and submit for a new
manual review. The driver photo and driving licence remain available.

Reopening pauses eligibility for new jobs. The backend blocks application changes
during assigned work. Draft details do not bypass document review. A later approved
vehicle applies to new assignments; existing journeys retain their vehicle snapshot
saved at claim. The account has one reviewed vehicle, not an interchangeable garage.

## Delete the Work profile

**Work → Your Work profile → Delete Work profile** opens a separate confirmation.
The driver must type **DELETE** and choose **Confirm delete Work profile**.
Native also exposes this through Account. The server blocks deletion during any
assigned negotiation, accepted fare awaiting booking or unfinished trip.

This removes the driver capability, active vehicle/details and current uploaded
document bytes, stops availability on every device and closes queued Work alerts.
The customer account, login sessions, past trips, receipts, safety reports and
review audit snapshots are retained. Minimal driver/application rows anchor those
records. This is Work profile deletion, not full-account erasure. Copies in
database pages, backups and prior downloads are not securely erased by the action.
An alert already handed to a push provider cannot be recalled.

The owner may apply again. Reapplication starts as a draft with no current
documents or approval; versions continue increasing, and historical review events
remain. Old deletion retries and stale forms cannot delete or overwrite the new
profile. Account enrollment/deletion and driver/availability/notification changes
share one transaction through injected ports; schema 18 remains unchanged.

Web uses `POST /api/account/driver-profile/delete`; native uses
`POST /api/mobile/v1/account/driver-profile/delete`. Both require an authenticated
owner, idempotency key and `{ expectedVersion, confirmation: "DELETE" }`.
Browser writes also require the existing same-origin and CSRF checks. No user ID
is accepted from the client. The response contains the updated customer account.

## Arrival notices

The assigned driver explicitly chooses **I have arrived**. The successful server
transition creates the rider's durable `arrive` inbox event in the same transaction.
Replaying that command does not create another event.

The notice includes driver name, number plate, make/model, category and colour from
the assigned journey snapshot. Generated artwork, client text and the driver's
later profile cannot supply these details. Legacy missing colour is shown as
**Colour not recorded**. Alert text is bounded and hidden control/directional
characters are removed.

Web shows the notice in the selected journey. Native shows it in the journey and
Updates, plus a banner for a recent unread arrival while the server still reports
the trip as arrived. The banner uses authenticated inbox data, refreshes during
foreground polling and clears if that refresh fails. A received push requests a
fresh inbox read; its payload cannot supply identity or select an account.

On configured, opted-in devices, the phone alert also includes those identity
details. Updates explains lock-screen visibility. Route, phone number, chat text,
private evidence and pickup/drop-off codes are excluded. Routing data contains
only an inbox event ID. Opening an alert checks server access and never accepts
a fare, verifies pickup or switches modes silently.

Before sending an unsent arrival job, the worker rechecks rider, device session,
token registration and trip status. Jobs are dropped after five minutes, or if
pickup has started or the booking was cancelled. Delivery remains best effort:
an alert already handed to Expo/APNs/FCM cannot be recalled, and a provider retry
can duplicate a phone alert. Historical inbox entries retain their timestamp;
opening the journey shows current status. See [phone-alert setup](mobile-journeys.md#optional-phone-alerts).

## A different car at pickup

Riders compare the physical plate, make/model and colour with the displayed record.
If anything differs, they should not board, hand over a parcel or share the pickup
PIN. **Vehicle doesn’t match?** opens Trip safety with that concern selected;
submitting remains a separate explicit action. Observations up to 480 characters
are saved with a `Vehicle mismatch:` prefix under the existing unsafe-behaviour
concern type. No database migration is required.

The existing safety service saves the assigned vehicle snapshot, reporter,
timestamp and last available driver-shared location. Only the reporter and
authorised administrators can read it. The safety review queue includes the
recorded vehicle colour and category. Reporting does not automatically suspend
the driver, cancel the journey or impose a charge. The rider can explicitly
cancel from the journey before pickup. The existing one-open-concern limit applies.

An optional [AI vehicle photo check](vehicle-photo-checks.md) now reads a rider's
photo and compares the plate and visible attributes with the assigned record.
It requires configured server credentials and does not prove physical presence,
image freshness, plate authenticity or safety. GPS locates a phone rather than
identifying a car. Generated category images are not reference evidence.
The preview does not provide staffed emergency response.

## Verification and remaining acceptance

Tests cover arrival identity, persistence after a new vehicle approval, recipient
isolation, excluded codes/contact data, retry deduplication, suppression after
pickup/cancellation/expiry, wire contracts, and private mismatch reports without
automatic penalties. DOM checks cover rider arrival, reporting and resets. Native
verification checks types, controllers and both JavaScript bundle exports.

Signed builds on two real phones still need arrival/lock-screen tests, foreground
banner timing, accessibility, long names/large text, offline pickup and vehicle
change/reapproval. Real APNs/FCM delivery, browser visual acceptance and deployment
have not been exercised by automated checks.

References: official [Expo notification listeners](https://docs.expo.dev/versions/latest/sdk/notifications/)
and [push message/receipt documentation](https://docs.expo.dev/push-notifications/sending-notifications/).
