# Native work, journeys and updates

Release 0.23 / mobile 0.7 completes the native journey workflow for Standard/SUV
rides and van/truck/motorcycle deliveries. Both people can use the native app or
the website against the same records. This remains a development preview with
fictional fares and simulated payments. Restaurant ordering is separate.

## Run a complete journey

1. Use two fictional accounts, one customer and one manually approved driver.
   The vehicle category must match; deliveries also require approved load capacity.
2. In **Work**, choose **Go online with my location** after reviewing the location
   disclosure. Only foreground permission is requested. Local development also
   offers sample areas; choose the same sample pickup area as the customer.
3. Request a journey from Home. The online driver sees the approximate pickup and
   destination and taps **Take request and discuss fare**. Claiming ends the
   availability lease and opens the assigned journey; it does not accept a fare.
4. Send an exact fare offer in naira. The other participant accepts the displayed
   amount before its two-minute expiry. Only the customer confirms the booking.
   Chat is independent of fare consent and supports pagination, explicit read
   markers, reporting and a read-only completed conversation.
5. The driver marks departure and arrival, then enters the customer's pickup PIN.
   The app shows the PIN only to the customer. For deliveries, the sender sees a
   separate drop-off code after collection and privately gives it to the recipient.
   Completion requires that code for a delivery. Passenger completion has no
   drop-off code. Wrong-code lockouts and retry counters use the existing service.
6. Use Activity or the request card to reopen the journey. Completed/cancelled
   records appear in history and do not block taking another job.
7. Updates shows requests, offers, messages and progress, with an unread badge,
   pagination and account-scoped read markers. Opening an update checks current
   server access. A phone-alert tap prompts review; it never accepts an offer,
   changes a draft or switches modes by itself.

## Availability and interrupted connections

Work renews its lease every ten seconds while the app is active, using a fresh GPS
fix for GPS matching. Leaving/backgrounding stops renewal and attempts to go
offline; if a connection is lost, the existing server lease expires. Returning
requires explicit Go online. There is no background tracking or native trip map.
A location permission dialog may pause the app; after allowing it, choose Go
online again if prompted. A precise fix must satisfy the existing Abuja, freshness
and accuracy rules. Permission denial leaves the driver offline.

A lease binds to the stable native device family and app client ID, so access-token
rotation does not break it. Another device/browser can take the account offline,
but cannot heartbeat this lease. Revocation, approval changes, expiry and claiming
end eligibility. Switching from Work to Customer confirms going offline and waits
for the server before reporting success.

Journey/work controllers keep an uncertain command's original key and payload in
account-scoped memory, including its version, offer ID or code. Manual retry sends
that same command; it cannot become another offer, message or job. Controllers
survive native navigation within the signed-in account, discard late reads on
backgrounding, and clear on account removal. They are not an offline outbox:
force-quitting loses local pending commands; reopen the saved journey and review
its authoritative state before acting. No mutation retries merely because a timer
fired. Chat read markers advance only after the user marks displayed messages read.

## Optional phone alerts

The durable inbox works without Expo, APNs or FCM configuration. Push stays off by
default. No real push delivery was exercised in automated tests.

For a signed development/device build, configure an Expo/EAS project and its iOS
APNs / Android FCM credentials using the official
[Expo setup guide](https://docs.expo.dev/push-notifications/push-notifications-setup/).
Set the same public UUID in these two environments:

- Backend: `TAXI_AI_PUSH_ENABLED=true`, `TAXI_AI_EXPO_PROJECT_ID=<project UUID>`.
- App build: `EXPO_PUBLIC_EXPO_PROJECT_ID=<same project UUID>`.
- If Expo enhanced push security is enabled, set `TAXI_AI_EXPO_ACCESS_TOKEN` on the
  backend only. Never put it in mobile configuration or version control.

Rebuild the native app; plugin changes cannot be delivered as JavaScript alone.
In Updates, choose **Enable phone alerts**. Android creates its channel before
requesting permission. The app checks that its project matches the API and requires
an installed device build; Expo Go does not enable remote push. Permission denial,
network timeout and mismatched configuration leave the inbox usable. Disable alerts
from Updates or revoke the signed-in device. Re-enable to renew a changed token.

The provider uses fixed HTTPS Expo send/receipt endpoints and bounded timeouts.
[Expo delivery semantics](https://docs.expo.dev/push-notifications/sending-notifications/)
mean a ticket is only acceptance by Expo; a successful receipt is acceptance by the
platform provider, not proof that a person saw it. Most alerts remain generic.
Rider arrival alerts include the assigned driver's name, vehicle make/model,
category, colour and number plate; Updates discloses lock-screen visibility.
They exclude routes, contact numbers, parcel/chat text and PINs. Routing data
contains only an inbox event ID. See [pickup identity](pickup-identity.md) for
vehicle changes, in-app notices and suppression of stale arrival jobs.

Notifications and delivery jobs commit in the same SQLite transaction as their
ride/chat event; replaying a business command does not duplicate the inbox event.
Provider calls occur afterward, outside transactions. Jobs have persistent attempt
counts, retry times and a recovery lease; receipts are checked after 15 minutes.
Retries are capped at eight attempts and jobs age out after a day (unsent nearby
requests after five minutes). Delivery is at least once: a lost provider response
can cause a repeated phone alert, while the inbox and business commands stay deduplicated.
Revoked/expired sessions, opt-out and token reassignment invalidate old queued jobs.
DeviceNotRegistered disables that token. The single-process worker stops before
its database closes. Do not run concurrent worker processes against this database.

## API and persistence

All routes are under `/api/mobile/v1`, bearer-only and versioned. Browser cookies,
origins and client-selected modes do not grant native privileges.

| Endpoint | Purpose |
| --- | --- |
| GET `/work?clientId=<UUID>` | Own availability, eligible job previews, active work and cross-mode work |
| POST `/work/online?clientId=<UUID>` | Explicit GPS/sample availability with an idempotency key |
| POST `/work/:id/offline?clientId=<UUID>` | Idempotent account-owned offline command |
| POST `/work/:id/heartbeat?clientId=<UUID>` | Owning device/client, increasing sequence and fresh GPS |
| GET `/journeys/:id` | Participant projection, current offer, permitted controls and own PINs |
| POST `/journeys/:id/:action` | Claim/propose/accept/confirm/depart/arrive/start/complete/cancel, exact version and key |
| GET `/journeys/:id/chat?after=<sequence>` | Up to 100 messages; caller-relative sender flag |
| POST `/journeys/:id/chat/messages` | Idempotent message send |
| POST `/journeys/:id/chat/read` | Monotonic read-through marker |
| POST `/journeys/:id/chat/messages/:messageId/report` | Participant message report |
| GET `/notifications?before=<id>` | Latest 50 own updates, unread count and push settings |
| POST `/notifications/:id/open` or `/read` | Access-checked destination or own read marker |
| POST `/notifications/push` or `/push/disable` | Bind/disable a token on this authenticated device |

Schema 17 adds nullable `driver_availability.native_session_id`,
`account_notifications`, `push_registrations` and `push_jobs`. Existing web leases,
accounts, credentials, approvals, trips and retries are preserved. Old releases
refuse the newer schema. Sanitized snapshots clear native lease bindings and device
families; foreign-key cascades remove push tokens/jobs while retaining inbox history.
Rides and chat call injected notification ports; neither imports notification storage.
Native adapters delegate commands to existing services and validate wire projections.

## Verification and remaining acceptance

Run `npm run verify` and `npm run mobile:verify`. Automated coverage includes all
five complete native category journeys; native/web interoperability; fare/version
races; session rotation, revocation and cross-device ownership; private chat and
updates; transactional rollback and restart; interrupted native writes; background
GPS races; opt-out/token reassignment; mocked Expo tickets/receipts and migrations.
The native verifier checks types and exports both platform bundles, not signed apps.

Actual iOS/Android/simulator, keyboard, tablet and screen-reader review is still
required. Review permission dialogs, precise/approximate/denied GPS, offline mode
switching, app lock/background behavior, expired offers, notification permission
revocation, cold/warm alert taps, wrong-account alert taps, chat pagination/reporting
and both pickup/drop-off lockouts. Test real APNs/FCM receipt delivery only after
configuring the project with test devices. No live deployment or store release is
part of this change. Native voice and payments remain separate integrations.
[Mobile safety](mobile-safety.md) and explicit [foreground trip location
sharing](mobile-trip-location.md) have since been added; their real-device
acceptance remains pending.
