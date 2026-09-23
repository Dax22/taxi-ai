# Native trip location sharing

The assigned driver can choose **Share my location** on Journey or Safety to
publish their phone's location during a confirmed trip. The customer sees the
latest coordinates, accuracy and age in either screen. Active private trip links
use the same position, and a manually saved safety incident can include it in
the incident snapshot. Availability GPS remains separate: going online, accepting
a fare, creating a link or opening Safety does not consent to trip sharing.

## Consent and lifecycle

- A confirmation explains who can view the position before foreground location
  permission is requested. No background permission or service is enabled.
- While Taxi Ai remains open, the driver sends a fresh fix about every ten
  seconds. Moving between Journey, Safety and other app screens preserves the
  explicit sharing session. A visible app-wide indicator links back to the controls.
- Stop prevents further publication immediately and requests server cleanup.
  Leaving the foreground or signing out also stops new updates. Returning to the app never
  resumes it automatically. If the permission dialog backgrounds the app, choose
  Share my location again after allowing permission.
- Delayed permission and GPS results are discarded after Stop, backgrounding or
  account teardown. In-flight publications may finish before cleanup; an
  unacknowledged stop cannot promise immediate removal at the server.
  An already-running OS one-shot GPS request cannot be cancelled by this adapter;
  its late result is discarded and no new request is scheduled after Stop.
- Lost start/stop responses retain the original command key. **Resolve interrupted
  location action** reconciles that action and closes any uncertain start; the
  driver then starts again explicitly. GPS fixes are never queued for offline replay.
- A point becomes **Last known location** after 30 seconds. An abandoned server
  sharing session expires after 60 seconds without an accepted update. On a
  failed position update the phone stops scheduling fixes and attempts cleanup.
- Trip completion/cancellation clears the active position inside the trip
  transaction. Device revocation, session expiry or loss of driver approval also
  invalidates sharing. Only the latest point is stored, without a route history.
  A saved incident can retain its earlier snapshot after sharing ends.

GPS must be inside Nigeria, be under 30 seconds
old and report accuracy within 200 metres. Fix age is translated to server time;
stale or implausible timestamps are rejected. These checks validate the report,
not the device's actual physical location. The app displays reported location,
not a guaranteed arrival time or emergency-response service.

## Native API

All routes below are under `/api/mobile/v1`, use native bearer authentication and
require the per-controller `?clientId=<UUID>` ownership nonce. The API reuses the
existing location service and participant checks.

| Method and path | Result |
| --- | --- |
| GET `/tracking/rides/:rideId` | Participant-only `rideId`, `isDriver`, `canShare`, latest `share` |
| POST `/tracking/rides/:rideId/start` | Assigned approved driver, confirmed trip, `{}` and idempotency key |
| POST `/tracking/shares/:shareId/position` | Owning device/controller, increasing sequence and fresh position |
| POST `/tracking/shares/:shareId/stop` | Assigned approved driver, including another device, `{}` and idempotency key |

Native sharing stores `native:<device family ID>` in the existing internal
session binding. Access-token rotation preserves the session; device-family
revocation or expiry ends it. Browser session hashes and native booking's
access-token validation retain their existing behavior. No schema migration or
database reset is needed. Identity bindings never appear in native responses.

## Verification and remaining acceptance

Automated coverage checks authorization, session rotation/revocation, cross-device
ownership, position ordering, stale/expired leases, trip cleanup, safety-link and
incident visibility, immutable retries, late permission/network results, and
foreground cancellation. Runtime readers reject mismatched journeys/shares and
incomplete stop confirmations. These are fixture tests, not real GPS evidence.

Follow the two-phone checklist in [device-preview.md](device-preview.md) against
the private hosted backend. Physical phones, signed builds, location permission
dialogs, screen layouts and real GPS remain unverified here. Background or
locked-screen tracking is outside this foreground implementation. Real contact
alerts, staffed response and hosting still require their separate setup.

The native adapter uses the installed Expo location SDK's foreground permission
and current-position APIs; see [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/).
