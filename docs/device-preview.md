# Installing and accepting the device preview

The `preview` EAS profile builds an Android APK or an iOS ad hoc app with a
bundled JavaScript application. It does not require a Metro server. The
`simulator` profile produces an iOS Simulator build, not a phone installation.
Neither profile publishes to an app store or deploys the backend.

## Account and hosting prerequisites

Use the project's own Expo/EAS account, Firebase project and (for physical iOS
builds) Apple Developer account. Confirm ownership of the provisional
`com.taxiai.app` identifier before registering it. Do not paste signing keys,
service-account JSON, passwords or access tokens into chat or commit them.

Deploy the private backend first using [staging.md](staging.md): an Alibaba
server with persistent disk, Docker Compose and a DNS name pointing to it.
Keep the invited-tester gate and only publish gateway ports 80/443. Take a
backup before upgrading an existing database. Configure maps for hosted booking;
the sample-area workflow is local-only. Hosting credentials and payment readiness
have not been verified, and no host has been provisioned by this change.

The staging Compose file now forwards `TAXI_AI_PUSH_ENABLED`,
`TAXI_AI_EXPO_PROJECT_ID` and the optional backend-only
`TAXI_AI_EXPO_ACCESS_TOKEN`. Run the documented container `config:check` command
before starting it; it validates enabled push configuration without sending alerts.

## Prepare the signed build

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
| Background, permission denial, reconnect, account switch | No hidden tracking, private data cleared, uncertain commands retry unchanged | Controller tests only |
| Native trip GPS and private trip link | Driver explicitly shares; customer and authorized link viewer see matching position/age; stopping removes it | API/controller fixtures only |
| Platform street maps | Google Maps on Android, Apple Maps on iOS; route/driver pins fit, stale labels and attribution remain visible | Configuration/type/bundle checks only; real tiles unverified |
| GPS interruption and session lifecycle | Navigation keeps foreground sharing; background stops it; no auto-resume; revoked/closed/expired trips cannot publish | API/controller fixtures only |
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

For trip GPS acceptance, use two physical phones within the Abuja preview area.
Book and confirm a trip, then choose **Share my location** on the driver's
Journey screen. Confirm an actual moving GPS fix and its timestamp on the customer
phone and private trip link. Navigate to Safety and back without stopping updates.
Test denied/approximate permission, Stop during permission or GPS acquisition,
network loss, background/lock and return, opening the OS trip-link share sheet
and returning (restart sharing explicitly if the app lost foreground), another driver's-device Stop, device
revocation, completion and cancellation. Confirm old fixes become stale at 30
seconds and unavailable by the 60-second lease deadline if server cleanup cannot
be delivered. Record actual device/build evidence; mock coordinates do not pass
the real-GPS row. See [mobile-trip-location.md](mobile-trip-location.md).
