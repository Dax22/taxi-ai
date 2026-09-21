# Vehicle changes and pickup identity

## Change the registered vehicle

Native: **Account → Your vehicle → Manage vehicle and documents**, or the same
button in **Work**. Web: **Account → Manage vehicle and documents** opens the
driver application in Work. Choose **Edit vehicle or documents** to reopen a
submitted or approved application. Update make, model, year, colour, number plate,
category and applicable load capacity; replace the vehicle photo, registration
and insurance evidence as necessary, then submit for a new manual review.

Reopening pauses eligibility for new jobs. The backend blocks application changes
during assigned work. Draft details do not bypass document review. A later approved
vehicle applies to new assignments; existing journeys retain their vehicle snapshot
saved at claim. The account has one reviewed vehicle, not an interchangeable garage.

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
