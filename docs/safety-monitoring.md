# Experimental trip safety monitoring

This release implements foreground sensor checks, a manual panic control,
30-second server-side cancel countdowns, a durable delivery queue, and reviewed
location warnings on web and native Safety screens. It does **not** establish
reliable crash recognition, scream recognition, emergency dispatch, background
protection or a staffed response. Existing manual test SOS remains a separate
simulator and never sends messages.

## Use the feature

1. Update dependencies: `npm ci` and `npm --prefix apps/mobile ci`. Restart the
   server (`PORT=3002 npm run dev` if that is your local preview port). Schema 26
   upgrades the existing database in place; no database reset is needed. Back up
   existing data with the matching previous release before upgrading it.
2. Confirm a test trip and save fictional trusted contacts. Web: select the trip
   in `/app` and scroll to **Safety monitoring**. Mobile: open the journey's
   **Safety / SOS** screen. Rebuild a native development client after adding
   expo-sensors/expo-audio; an old binary cannot gain the native modules by reload.
3. Select crash and/or loud-distress checks, recipients, and the sharing consent.
   Both checks can be off if you only want the manual panic countdown. Select
   **Start monitoring** and grant foreground location, motion (if selected), and
   microphone (if selected) permissions. Permission is never requested on load.
4. Keep this screen visible and the phone awake. Leaving the screen, backgrounding,
   locking the phone, losing sensor input, or a polling failure pauses sensing.
   It never silently restarts. A countdown already saved on the server continues;
   use **I am safe — cancel unsent alert** to cancel, or **Stop monitoring and
   cancel unsent alerts** to withdraw consent. Already submitted messages cannot
   be recalled. Sign-out/session revocation and trip closure cancel pending work.
5. Use **Start panic alert countdown** to exercise the flow with fictional data.
   With no gateway configured, recipients show **unavailable**. No simulated
   delivery or notification is presented as real. Do not test by crashing a
   vehicle or creating an actual emergency.

The client reads status every three seconds and sends a heartbeat every fifteen
seconds while monitoring. Monitoring leases expire after 45 seconds without a
heartbeat. Accepted signals receive a server-owned 30-second countdown. The
five-second worker cadence may add up to five seconds before dispatch starts.

## What the sensors actually do

- Possible impact: a peak of at least 4 g, a GPS speed at least 5 m/s within the
  previous five seconds, followed by a speed at or below 2 m/s within 0.5–10 seconds.
- Possible loud distress: at least 2.5 seconds of sustained audio level at or above
  -12 dBFS, with gaps over 500 ms resetting the window. dBFS is digital amplitude,
  not calibrated sound pressure and not proof of screaming, violence or panic.
- Automatic signals have a two-minute device cooldown. The server also limits
  each reporter/trip to five new alerts per hour and one pending alert at a time.

These are deliberately labelled experimental heuristics. Device movement, phone
mounting, GPS lag, microphone gain, music and other conditions can cause misses
or false alarms. No trained scream model is included. Threshold calibration,
labelled evaluation, physical-device tests and native background execution are
outstanding work before presenting this as a dependable safety capability.

The browser uses DeviceMotion and Web Audio; native uses expo-sensors and
expo-audio's in-memory PCM stream. No audio file or transcript is created or sent
to the server. Raw samples are discarded. Only a threshold summary is submitted.
Browser sensor support varies and requires HTTPS or a permitted localhost
context. A desktop without motion sensors reports crash monitoring unavailable.

## Delivery configuration

Leave these blank to disable external delivery (the default):

```dotenv
SAFETY_ALERT_GATEWAY_URL=https://your-approved-gateway.example/alerts
SAFETY_ALERT_GATEWAY_TOKEN=replace-with-a-secret-at-least-24-characters-long
SAFETY_EMERGENCY_SERVICE_NAME=
SAFETY_EMERGENCY_SERVICE_ENABLED=false
```

The endpoint must implement the following authenticated gateway contract. It is
not an SMS vendor URL or a public helpline number. The app sends HTTPS JSON with
`Authorization: Bearer <token>` and `Idempotency-Key: <delivery job UUID>`. The
gateway must persistently deduplicate that key, accept/reject recipients, deliver
via its configured messaging system, and return the same receipt on retries:

```json
{"accepted":true,"reference":"provider-receipt-123"}
```

Request shape (values abbreviated):

```json
{
  "idempotencyKey": "delivery-job-uuid",
  "recipient": {"kind":"family","name":"Saved contact","phone":"+234...","version":0},
  "alert": {
    "id":"alert-uuid", "kind":"impact", "unverified":true,
    "rideId":"ride-uuid",
    "passenger":{"kind":"account","id":"user-uuid","name":"Passenger"},
    "driver":{"id":"driver-uuid","name":"Driver","vehicle":{"model":"Vehicle","plate":"Plate"}},
    "reporter":{"id":"user-uuid","name":"Reporter"},
    "pickup":"Pickup label", "destination":"Destination label",
    "location":{"lat":9.0,"lng":7.0,"accuracy":12,"capturedAt":0,"source":"reporter_device","stale":true},
    "recordedAt":0
  }
}
```

Guest passengers carry their booked name and `kind: guest`, rather than the
booker's identity. Private guest phone numbers, account emails, PINs, documents,
chat, audio and the full contact list are excluded. A location may be null. A
reporter location must be recent (30 seconds) and accurate within 200 m; otherwise
the last driver-shared position is used if available. This is a timestamped
snapshot, not a continuous tracking subscription; stale positions are marked.

To enable the separate emergency recipient, configure the gateway's agreed
emergency-service integration, then set its display name and
`SAFETY_EMERGENCY_SERVICE_ENABLED=true`. Users must additionally opt in for that
trip. The gateway receives `recipient: {kind: "emergency", name: "..."}` and
owns jurisdiction-specific routing. No public emergency number is automatically
dialled, guessed or sent an SMS by this app. No provider or emergency partner
was connected or contacted during implementation.

Delivery attempts use an eight-second timeout and the same idempotency key for
up to three attempts. A 30-second lease permits restart recovery. Work older
than two minutes past the countdown deadline expires instead of unexpectedly
sending stale alerts after downtime. Contact edits/removal, consent withdrawal,
session revocation and trip closure are checked before each attempt. Enabling a
gateway later never sends alerts originally recorded as unavailable.

`accepted` means the gateway acknowledged receipt; it does not prove SMS delivery,
family notification, a dispatched responder or a resolved emergency. A failed
attempt can be an uncertain network outcome. The gateway's deduplication is
required to avoid duplicate delivery in that case. For real emergencies, users
must be able to seek help directly; this experimental flow is not a substitute.

## Reviewed location warnings

Participants in confirmed active trips can flag a point and describe a concern.
Web administrators see **Location warning review** and must enter a reason to
approve, reject or withdraw a report. Reports remain private until approved.
The web review control approves for 24 hours; the API permits up to seven days.
Warnings expire automatically at read time. No fabricated crime dataset is seeded.

Approved circular areas are compared with the saved road-route segments, pickup,
drop-off and last shared driver position. Without a saved route the UI explicitly
limits coverage to the shared position. A current phone position used in an alert
is not continuously uploaded. Warnings do not reroute a journey, penalise a
driver or establish that an area without a warning is safe.

## Architecture and persistence

- Shared: signal thresholds, route intersection and a lifecycle controller.
- Client adapters: browser and Expo sensor access; UI never owns HTTP credentials.
- API module: `modules/safety-monitoring` owns consent, countdown, authorization,
  expiry and recipient checks; SQL is isolated in its repository.
- Infrastructure: configurable HTTPS gateway, worker wiring and migration 026.
- Web routes: `/api/safety-monitoring/rides/:id`, with POST actions
  `preferences`, `heartbeat`, `signal`, `cancel`, `zones`.
- Native: the same participant routes below `/api/mobile/v1/safety-monitoring`.
- Staff-only: GET `/api/admin/safety-zones`, POST `/api/admin/safety-zones/:id`.

Commands use authenticated participant identity, browser CSRF or native bearer
authentication, strict input validation and actor-scoped idempotency. Native has
no administrator review surface. Contacts and alerts are reporter-owned. Snapshot
exports disable monitoring and cancel outstanding deliveries so a restored
database never revives a pending emergency. Schema 25→26 is additive. Alert
packets remain private database records; access control and storage protection
are required, and automated retention deletion is not implemented.

## Verification

`packages/shared/test/safety-monitoring.test.mjs` covers threshold continuity,
route intersections, consent, foreground cleanup, lost responses and immutable
retries. `services/api/test/safety-monitoring.test.mjs` covers authentication,
ownership, countdown deadlines, cancellation, revocation, recipient changes,
bounded delivery, disabled-provider behavior, snapshot recovery and gateway
receipts. Existing SOS, migration, HTTP/static and native checks also run.
Provider calls use in-memory mocks; physical sensor accuracy, real recipient
delivery and emergency-service dispatch have not been validated.
