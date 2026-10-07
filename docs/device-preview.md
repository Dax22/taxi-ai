# Installing and accepting the device preview

> **Current production acceptance path:** use [`mobile-production-acceptance.md`](mobile-production-acceptance.md) and the EAS `acceptance` profile for signed iOS/Android builds against `https://taxiai.app`. This document retains the deeper tracking/device scenarios. The old Alibaba staging references below are historical and are not the current production host.

The `preview` EAS profile builds an Android APK or an iOS ad hoc app with a
bundled JavaScript application. It does not require a Metro server. The
`simulator` profile produces an iOS Simulator build, not a phone installation.
Neither profile publishes to an app store or deploys the backend.

## Account and hosting prerequisites

Use the project's own Expo/EAS account, Firebase project and (for physical iOS
builds) Apple Developer account. Confirm ownership of the provisional
`com.taxiai.app` identifier before registering it. Do not paste signing keys,
service-account JSON, passwords or access tokens into chat or commit them.

The current production backend is already hosted on Tencent Cloud and served at `https://taxiai.app`. Keep gateway exposure limited to HTTPS/HTTP, take a backup before database upgrades, and use the Production Acceptance Center for real-device/provider evidence. The sample-area workflow remains local-only.

The staging Compose file now forwards `TAXI_AI_PUSH_ENABLED`,
`TAXI_AI_EXPO_PROJECT_ID` and the optional backend-only
`TAXI_AI_EXPO_ACCESS_TOKEN`. Run the documented container `config:check` command
before starting it; it validates enabled push configuration without sending alerts.

## Prepare the signed build

Background/locked-screen work tracking needs a **new installed development or
release build**. The current native configuration enables iOS background
location, Android background location/foreground-service permissions and Expo
TaskManager. An older binary or JavaScript-only update is insufficient; Expo Go
does not verify this behavior. See [Expo SDK 57 Location](https://docs.expo.dev/versions/v57.0.0/sdk/location/)
and [TaskManager](https://docs.expo.dev/versions/v57.0.0/sdk/task-manager/).

Native maps use Google Maps on Android and Apple Maps on iOS. Configure the
restricted Android SDK key as `GOOGLE_MAPS_ANDROID_API_KEY` in EAS preview before
building; follow [mobile-maps.md](mobile-maps.md). This is separate from Firebase
phone-alert configuration. iOS MapKit needs no Google Maps key.

From `apps/mobile`, using the official EAS CLI in your authenticated terminal:

```bash
npx eas-cli login
npx eas-cli init
```

Link the existing Taxi AI project, or create it under the intended owner. Record
its UUID as `EXPO_PUBLIC_EXPO_PROJECT_ID` in the EAS **preview** environment and
`TAXI_AI_EXPO_PROJECT_ID` on the server. In that EAS environment also set
`EXPO_PUBLIC_API_ORIGIN` to the real HTTPS staging origin, not localhost or the
CI fixture. Public app configuration cannot contain credentials. Pull public
preview environment values for local CLI configuration resolution with
`npx eas-cli env:pull --environment preview`, checking the target file before
overwriting any existing local settings.

For Android, register a Firebase Android app with the matching package ID. Add
its **google-services.json client configuration** as an EAS file environment
variable named `GOOGLE_SERVICES_JSON` in the preview environment. The dynamic
app configuration maps that file into the native Android project. Separately
upload the **FCM V1 service-account key** to EAS credentials for that app. The
service-account key must never be used as `GOOGLE_SERVICES_JSON` or bundled.
Follow [Expo's FCM credential instructions](https://docs.expo.dev/push-notifications/fcm-credentials/).

```bash
npx eas-cli credentials --platform android
npx eas-cli build --platform android --profile preview
```

For iOS, register the test phone and configure Apple signing and the APNs push
key through EAS's authenticated credential flow:

```bash
npx eas-cli device:create
npx eas-cli credentials --platform ios
npx eas-cli build --platform ios --profile preview
```

Review provider build charges before starting paid jobs. EAS manages signing;
this repository does not contain certificates or private keys. Use the returned
installation link on the registered device. Restrict internal build downloads
to authorized Expo users in project settings. See
[Expo internal distribution](https://docs.expo.dev/build/internal-distribution/).
An iOS simulator build uses `--platform ios --profile simulator`; it does not
satisfy this app's physical-device phone-alert acceptance gate.

## Acceptance record

Record commit SHA, build ID, OS/device, date and evidence for each row. Use two
fictional accounts, including one manually approved driver. Do not mark a row
passed based on JavaScript bundle exports or mocked provider tests.

| Check | Expected result | Current evidence |
| --- | --- | --- |
| Small phone/tablet layout, large text, keyboard, screen reader | Controls readable and reachable; no clipped fare or verification fields | Not run on devices |
| All five category journeys | Eligible driver, explicit fare acceptance, customer confirmation, completion and saved history | API tests only |
| Delivery codes, cancellation, stale offers | Wrong codes cannot complete; invalid transitions rejected | API tests only |
| Background, permission denial, reconnect, account switch | No tracking without explicit consent; Stop/account changes end collection; uncertain commands retry unchanged | Controller tests only |
| Native trip GPS and private trip link | Driver explicitly shares; customer and authorized link viewer see matching position/age; stopping removes it | API/controller fixtures only |
| Platform street maps | Google Maps on Android, Apple Maps on iOS; route/driver pins fit, stale labels and attribution remain visible | Configuration/type/bundle checks only; real tiles unverified |
| GPS interruption and session lifecycle | Explicit sharing survives background/lock when permitted; Stop/logout/revocation/closed jobs end it; login never implicitly starts it | API/controller fixtures only; physical tests outstanding |
| Food courier GPS and work requirements | Buyer sees GPS after collection, with private-pickup masking; ride depart/arrive/start and food pickup/arrive need fresh sharing | API/controller fixtures only |
| Background permission and indicators | Android foreground notification and iOS location indicator; denial respected and Stop always available | Config/type/bundle checks only; physical tests outstanding |
| Push opt-in and opt-out | Correct project registers; opt-out stops future delivery | Mocked provider tests only |
| Foreground/background/closed-app alert tap | Own update opens for review without automatic booking actions | Not run on devices |
| Cross-account and revoked-device alerts | No private content leak or unauthorized journey access | API tests only |
| HTTPS gate, restart persistence, backup/restore | Authenticated preview remains isolated and saved trips survive | No live-host evidence |

On 2026-09-21 the available remote browser rejected the local `/app` preview
with `ERR_BLOCKED_BY_CLIENT`. No screenshots or visual passes were obtained.
The workspace had no Android emulator, Xcode simulator, Docker CLI or Expo/cloud
credentials. These are unresolved execution prerequisites, not passing results.

Once signed apps and the backend are reachable, enable push on the backend,
recreate the app container, then choose **Updates → Enable phone alerts** on
each test phone. Generate an ordinary test offer/message from the other account
and verify inbox, receipt and visible phone delivery. Keep push off until the
matching project and provider credentials are configured.

## Two-phone work-tracking acceptance

Use new signed builds on Android and iOS, a driver/courier phone inside Nigeria
and a separate buyer/customer account. Viewers can be outside Nigeria and need
not grant GPS permission. Use fictional jobs; a passenger or stationary tester
should operate the controls rather than a moving driver.

1. **No automatic collection:** sign in, go online, accept work and open a map.
   Sharing stays off until **Share my location** is confirmed. Ride/parcel
   depart, arrive and start and food pickup and arrive require fresh sharing.
   Stop, completion/handover, cancel and safety remain available.
2. **Permissions:** confirm the viewer/background explanation, allow foreground
   then background access (Always on iOS; Android may open settings), and check
   the OS notification/indicator. Test denial, approximate access and iOS Allow
   Once: no hidden fallback or repeated background prompts. Test Stop during
   permission handoff and initial GPS acquisition; late results cannot start it.
3. **Real location:** verify the moving point, accuracy and capture time on the
   viewer phone. Navigate between app screens without ending sharing. Check
   authorized ride links and accepted parcel invitations after collection. Food
   buyers see GPS only after collection, and private kitchen proximity can mask
   it. No food-recipient link or alert is automatically sent.
4. **Background/lock:** switch apps for at least two minutes, then lock the driver
   phone for at least two minutes while safely changing position. Check updates
   continue when permitted and record cadence/interruption. Ten seconds is
   requested, not guaranteed. Return to the same explicitly consented share
   without a second publisher. Test the OS trip-link share sheet as well.
5. **Network loss:** disable networking while sharing. The viewer marks a point
   stale after 30 seconds and removes it after the 60-second share lease expires.
   The failed send stops collection. Reconnect: no old fixes replay, and the
   driver reviews the job and explicitly starts again.
6. **Stop/logout/revocation:** separately Stop locally, Stop from another
   authorized driver device, sign out, revoke the device remotely and revoke OS
   background permission. No new authorized point is accepted; native collection
   ends when notified/next executed. Reopening/login never implicitly restarts it.
   Without network, allow server lease expiry rather than claiming immediate
   remote removal. Verify private state clears across account changes.
7. **Terminal jobs:** complete/cancel ride and parcel trips and deliver/cancel
   food orders while sharing. The active point disappears and later callbacks
   cannot restore it. Food keeps ordinary handover-code checks; the buyer shares
   the code with any recipient manually.
8. **OS limits/deadline:** force-quit and exercise battery restrictions. Missing
   updates must become stale/unavailable; continuous tracking after force-quit is
   not supported. Validate capability expiry using a shortened deadline in a
   controlled fixture: its maximum life is 12 hours and it must neither refresh
   account credentials nor authorize another job. Restart requires explicit
   consent after tracking ends.

The task stores only a scoped publishing/Stop capability and binding metadata in
a separate secure record, not account refresh tokens or GPS history. A silent OS
task cannot promise an immediate local shutdown time; closed/expired server
authorization must still reject later points. Record commit, build, OS/device and
observed results for every step. Mock GPS, passing tests and successful bundle
exports do not pass this physical-device acceptance gate. See
[mobile-trip-location.md](mobile-trip-location.md) for lifecycle and API details.
