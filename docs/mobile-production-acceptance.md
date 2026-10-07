# Taxi Ai signed mobile production acceptance

This runbook creates **installable signed internal builds** for real iPhone and
Android acceptance against the live Taxi Ai production backend. The mobile app is
React Native/Expo; iOS uses Apple Maps and Android uses Google Maps. A JavaScript
bundle export or Expo Go session is not evidence that background location, push,
native Google sign-in or signed-map configuration works on a real phone.

## Production target

- API origin: `https://taxiai.app`
- iOS bundle identifier: `com.taxiai.app`
- Android package: `com.taxiai.app`
- EAS profile: `acceptance` (internal distribution, preview environment)
- Production evidence: **Admin → Production acceptance**
- Build identity: **Mobile app → Account → Build identity**

The `acceptance` profile auto-increments the native build number. The app embeds
only non-secret provenance from the EAS worker: build ID, profile, platform, Git
commit, app/native version and API origin. Do not put signing credentials, Firebase
service-account keys, OAuth secrets or unrestricted map keys in source control.

## One-time EAS/project setup

Run these from `apps/mobile` on a trusted machine with the Taxi Ai Expo account:

```bash
npx eas-cli@24.10.0 login
npx eas-cli@24.10.0 init
```

Link the existing Taxi Ai project rather than creating duplicate projects. Set the
resulting EAS project UUID as `EXPO_PUBLIC_EXPO_PROJECT_ID` in the EAS **preview**
environment and configure the same UUID on the backend as
`TAXI_AI_EXPO_PROJECT_ID` before enabling production push.

Configure these **public/client build values** in the EAS preview environment:

- `EXPO_PUBLIC_API_ORIGIN=https://taxiai.app`
- `EXPO_PUBLIC_EXPO_PROJECT_ID=<Taxi Ai EAS project UUID>`
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<backend web OAuth client ID>`
- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<iOS OAuth client ID>`
- `GOOGLE_MAPS_ANDROID_API_KEY=<restricted Android Maps SDK key>`
- `GOOGLE_SERVICES_JSON=<EAS file variable for google-services.json>`

The Android Maps key is embedded in the application and therefore must be
restricted in Google Cloud to **Maps SDK for Android** plus the
`com.taxiai.app` package/signing certificate. `GOOGLE_SERVICES_JSON` is Firebase
client configuration, not a service-account key. The release check verifies its
Android package name before a build is queued.

Keep these **private credentials** in EAS Credentials/provider consoles, not EAS
public variables or this repository:

- iOS distribution/ad-hoc certificate and provisioning profile
- APNs push key
- Android keystore
- FCM V1 service-account credential
- any server OAuth/client secrets

## Register and configure physical devices

For the iPhone, register the test device before making the internal build:

```bash
npx eas-cli@24.10.0 device:create
npx eas-cli@24.10.0 credentials --platform ios
```

For Android, confirm the remote keystore and FCM credential setup:

```bash
npx eas-cli@24.10.0 credentials --platform android
```

EAS credential screens may require the Apple/Google account owner. Never paste
those credentials into chat or commit them to the repository.

## Fail-closed release check

The repository includes a release check that validates the build profile, matching
bundle/package IDs, app version, production HTTPS origin, EAS project UUID, OAuth
client IDs, Android Maps key presence and Firebase package binding without printing
key material.

From `apps/mobile`, after EAS is linked:

```bash
npm run acceptance:prepare -- --platform all
```

The command checks the EAS account/project and runs the release check inside the
EAS `preview` environment. It does **not** queue a cloud build and therefore does
not consume build quota. It ends with:

```text
MOBILE_ACCEPTANCE_READY_TO_QUEUE
```

Fix every reported failure before continuing.

## Queue signed builds

Review EAS usage/build charges first. Queue both platforms only with the explicit
`--run` flag:

```bash
npm run acceptance:build -- --platform all --run
```

Or build one platform at a time:

```bash
npm run acceptance:build -- --platform ios --run
npm run acceptance:build -- --platform android --run
```

The wrapper uses EAS CLI non-interactive JSON mode and prints only the queued build
IDs/status. Missing login, project linkage, environment values, registered iPhone
or remote signing credentials fails the process instead of silently producing an
unqualified build.

## Install and identify each build

Install the iOS internal-distribution link only on registered devices and the
Android APK link only on authorized testers. In each app open:

**Account → Build identity**

Record/share:

- evidence reference (`mobile:ios:<EAS build id>` or `mobile:android:<EAS build id>`)
- platform
- app version and native build number
- EAS build profile
- Git commit
- production API origin

The Build identity card intentionally contains no provider/signing secrets.

## Required two-phone acceptance

Use one real iPhone and one real Android phone. Use dedicated test accounts; one
must be a manually approved Driver. A stationary tester/passenger should operate
controls rather than a moving driver.

Run the full ride twice so each OS is exercised in both roles where practical:

1. Driver goes online with real GPS; Customer requests a real route.
2. Confirm eligible matching, destination preview, timed offer and fare negotiation.
3. Confirm vehicle/driver identity, chat and customer live-driver map.
4. Background and lock the Driver phone while explicitly sharing the active-trip
   location; verify the other phone receives fresh positions and stale handling.
5. Verify arrival, pickup PIN, trip start and completion.
6. Background/close the Customer app and verify configured push notifications.
7. Verify logout/revocation/Stop sharing ends private tracking and never resumes on
   a later sign-in without explicit consent.
8. Repeat with iOS/Android roles swapped where possible.

Then separately run Courier, Eats, Safety, masked audio and real low-value payment
acceptance as those providers become configured.

## Record results in the Acceptance Center

Open `https://taxiai.app/admin/acceptance` with an Owner/Operations account and
record the Build identity evidence reference and observed result. Do not mark an
item Passed because the build compiled or because configuration is present.

At minimum record:

- `Android production acceptance`
- `iPhone production acceptance`
- `Real two-phone ride`
- `Background push notifications`
- relevant tracking/safety/provider checks

The Acceptance Center retains history and automatically ages time-sensitive Passed
results into **Needs retest**. Re-run acceptance after material mobile, provider,
location/background-permission or signing changes.
