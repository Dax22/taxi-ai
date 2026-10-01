# Native work location sharing

The assigned driver chooses **Share my location** on Journey or Safety for a
confirmed ride or parcel trip. The assigned food courier uses the same controls
on Food order. Customers see the latest reported point, accuracy and age. Ride
trip links and accepted parcel invitations keep their existing viewer permissions.
Food buyers see courier GPS after collection, subject to private-pickup masking;
food tracking does not create recipient accounts or automatically send links.

Fresh live location is required before ride/parcel depart, arrive and start
actions, and before food pickup and arrive actions. The server enforces this;
another authorized device's fresh share can satisfy the job requirement. Stop,
completion/handover, cancellation and safety help remain available. Customers and
buyers do not need to publish their GPS. Availability remains separate: login,
going online, accepting work, opening maps or creating links never starts work
sharing. Background work tracking does not extend availability GPS collection.

## Consent and lifecycle

- A confirmation explains the viewers and background/locked-screen use before
  foreground and then background permission. Android may open settings; iOS
  needs Always access. Denial leaves sharing off. The permission handoff preserves
  only the pending explicit consent; Stop/account teardown cancels late results.
- One native task publishes in foreground and background, including a locked
  screen when the OS permits it. The foreground heartbeat does not create a
  second GPS publisher. Ten seconds is requested, not guaranteed. Android shows
  a foreground-service notification; iOS enables the location indicator. The
  app-wide banner provides review and Stop controls across app navigation.
- Stop immediately invalidates local publication, clears scoped authority, stops
  the native task and requests server cleanup. Logout/account changes also stop
  it. Login or a restarted UI never silently starts sharing. Already-sent requests
  may finish before cleanup; an unacknowledged stop cannot promise immediate
  remote removal. Late one-shot fixes are discarded rather than published.
- Lost start/stop responses retain the original command key. **Resolve interrupted
  location action** reconciles that action and closes any uncertain start; the
  driver then starts again explicitly. GPS fixes are never queued for offline replay.
- A point becomes **Last known location** after 30 seconds; the server share
  expires after 60 seconds without an accepted update. Permission, registration,
  storage or position failures stop collection and attempt cleanup. Only the
  newest fresh usable fix is considered; no offline GPS history is replayed.
- Trip completion/cancellation clears the active position inside the trip
  transaction. Device revocation, session expiry or loss of driver approval also
  invalidates sharing. Only the latest point is stored, without a route history.
  The task stops when its next callback/foreground check discovers the closed
  authority. A saved incident can retain its earlier snapshot after sharing ends.

GPS must be inside Nigeria, be under 30 seconds
old and report accuracy within 200 metres. Fix age is translated to server time;
stale or implausible timestamps are rejected. These checks validate the report,
not the device's actual physical location. The app displays reported location,
not a guaranteed arrival time or emergency-response service.

## Scoped background authorization

The account refresh-token vault keeps `WHEN_UNLOCKED_THIS_DEVICE_ONLY` protection.
Headless work never reads or refreshes account credentials. An authenticated
explicit start and first fresh point permit a random capability bound to one
ride/food job, share, controller and native device family. It permits only
position/Stop for that share, cannot read jobs or renew login, and expires after
at most 12 hours. Issuance rotates the previous capability; it is credential
rotation, not an idempotent business-command replay.

A separate `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` record holds only the capability,
binding, sequence, deadlines and connection metadata (including the private-preview
gateway header when needed). It has no coordinates, account access/refresh tokens
or GPS history. The database stores only its hash. Every publication rechecks
the native device family and normal job/share eligibility.

## Native API

Ordinary routes below are under `/api/mobile/v1`, use native bearer authentication and
require the per-controller `?clientId=<UUID>` ownership nonce. The API reuses the
existing location service and participant checks.

| Method and path | Result |
| --- | --- |
| GET `/tracking/rides/:rideId` | Participant-only `rideId`, `isDriver`, `canShare`, `required`, latest `share` |
| POST `/tracking/rides/:rideId/start` | Assigned approved driver, confirmed trip, `{}` and idempotency key |
| POST `/tracking/shares/:shareId/position` | Owning device/controller, increasing sequence and fresh position |
| POST `/tracking/shares/:shareId/stop` | Share's driver, including another signed-in device, `{}` and idempotency key; fresh GPS is not required |
| GET `/eats/orders/:orderId/tracking` | Food buyer/courier location and eligibility |
| POST `/eats/orders/:orderId/tracking/start` | Explicit assigned-courier start with idempotency key |
| POST `/eats/tracking/shares/:shareId/position` or `/stop` | Ordinary food update or explicit stop |
| POST `/tracking/background/start` | Account-authenticated capability rotation; body `{kind, jobId, shareId, clientId}` |
| POST `/tracking/background/position` | Capability bearer only; body `{sequence, lat, lng, accuracy, capturedAt}` |
| POST `/tracking/background/stop` | Capability bearer only; body `{}` |

Native sharing stores `native:<device family ID>` in the existing internal
session binding. Access-token rotation preserves the session; device-family
revocation or expiry ends it. Browser session hashes and native booking's
access-token validation retain their existing behavior. SQLite 044/045 and
PostgreSQL 017/018 add food shares and hashed background capabilities without
resetting existing rides, orders or accounts. Server identity hashes never appear
in ordinary tracking responses.

## Verification and remaining acceptance

Automated coverage checks authorization, session rotation/revocation, cross-device
ownership, position ordering, stale/expired leases, trip cleanup, safety-link and
incident visibility, immutable retries, late permission/network results, and
foreground/background consent, task registration races and scoped secure-state
failures. Runtime readers reject mismatched journeys/shares and
incomplete stop confirmations. These are fixture tests, not real GPS evidence.

Install a **new development or release binary** with the current Location plugin
and Expo TaskManager dependency. An older binary or JavaScript-only update cannot
add native permissions/background modes. Expo Go cannot validate this behavior.
The task is defined at module scope for execution without mounted React views.

OS scheduling, battery restrictions, permission changes and force-quitting can
interrupt updates. Continuous tracking after force-quit is not supported. If the
OS supplies no callback, the app cannot promise an exact local shutdown time;
the server still rejects closed/expired authority. The 30/60-second rules remain
in force rather than presenting unavailable GPS as live. Ride ETA remains an
approximation without live traffic or rerouting.

Follow [device-preview.md](device-preview.md) against the private backend. Physical
background/locked-screen GPS, permission dialogs, notifications and signed builds
remain unverified. Type checks, fixture tests and iOS/Android bundle exports do
not satisfy that acceptance gate or establish store approval/production launch.
Real contact alerts and staffed response require their separate setup.

Official implementation references: [Expo SDK 57 Location](https://docs.expo.dev/versions/v57.0.0/sdk/location/)
(permissions, configuration and platform limits) and
[Expo SDK 57 TaskManager](https://docs.expo.dev/versions/v57.0.0/sdk/task-manager/)
(module-scope definitions, persistent tasks and Expo Go restrictions).
