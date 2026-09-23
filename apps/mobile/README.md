# Taxi Ai — one iOS and Android app

The first native milestone uses Expo SDK 57, React Native and TypeScript, sharing
accounts, permissions and saved journeys with the website. It includes the yellow
brand, safe areas, flexible widths and iPad support. The launcher icon reuses the
existing vector mark on a dark square; it is not a new logo. Physical-device,
keyboard, accessibility and tablet QA remain pending.

## Included

- Existing-account sign-in, secure session restore and per-device sign-out.
- Home, Activity, Work, Updates and Account tabs; driver application, booking and journey screens.
- **Book a ride or delivery**: Standard/SUV passenger trips and van/truck/motorcycle
  parcels with recipient details, category pricing and approved capacity matching; explicit Abuja search, route/fare review, shared ride requests,
  same-command retries, current status, registered vehicle and pre-start cancellation.
  Local sample journeys work without live providers. [Booking guide](../../docs/mobile-booking.md).
- **Book for someone else** on Standard/SUV: identify the adult passenger and confirm
  their agreement before requesting. The booker negotiates and confirms the fare;
  assigned drivers see the passenger’s name without their phone number. A confirmed
  guest journey offers a revocable private link shared manually through the phone’s
  share menu. It includes pickup details and the PIN for the intended passenger;
  no automated SMS, guest chat or payment collection is provided. Guest drafts stay
  in memory, reset on account/category changes and retain the same payload on retry.
- Separate customer/work activity with current and paginated past journeys.
- Complete driver applications: guided make/year/model/colour dropdowns, years from
  2000 through the current year, Other fields for unlisted values,
  number plate, vehicle category, delivery load capacity, private PNG/JPEG uploads, expiry dates, review, corrections and resubmission.
- Resume the car chosen during website **Apply to drive**, including its year and
  colour, before completing personal details. Native enrollment saves the same
  structured fields so interrupted applications can continue on either interface.
- Shared rounded 3D-style vehicle icons in ten colours in Work and journey details.
  Illustrations are labelled; exact-model 3D assets are not included.
- The same manual approval workflow as the web. Administrators review on the web.
- Native device list and remote sign-out; web recovery at `/devices`.
- Delivery requests and recipient drop-off codes.
- **Taxi Ai Eats** on Home, **My food orders** in Activity, **My store** in Account
  and **Food deliveries** in Work, with the same restaurant/menu/order records as
  the website. Home kitchens can sell small batches, upload meal photos and offer
  delivery or customer pickup. **Sell from home** is available in Eats and Account;
  **My store** manages kitchen details, remaining portions and incoming orders.
  Eats asks for the delivery location first, then searches listed dishes and prices.
  Combine food from up to five kitchens, review each kitchen’s fees and place the
  orders together. Home kitchens and food vendors need only a town; restaurants
  list their business address. Private sellers share a collection point when
  food is ready. The page uses overhead Nigerian-food artwork. See [Eats setup](../../docs/eats.md) for the full test journey.
- A shared native system-font family across text, fields, buttons and navigation.

Native Work now supports foreground location, online/offline availability and job
claiming. Both participants negotiate fares, chat and finish rides/deliveries in the
app, including pickup and drop-off verification. Updates has a durable inbox and
optional configured Expo phone alerts. See [native journeys and push setup](../../docs/mobile-journeys.md).
Native Safety / SOS now opens trusted contacts, revocable trip links and private test incident records. See [mobile safety](../../docs/mobile-safety.md).
The driver can explicitly share foreground trip GPS from Journey or Safety; the customer and active trip links receive the latest position. See [native trip location](../../docs/mobile-trip-location.md).
Booking and shared-driver-location views can show Google Maps on Android and Apple Maps on iOS. Android signed builds need the restricted Maps SDK key; see [native maps](../../docs/mobile-maps.md).
Native calls, real payment controls, automatic crash detection and staff tools
remain separate milestones. Eats has a polling order timeline; its live courier
map and phone alerts remain future work.
This is a connected foundation, not a store-ready transport service.

## Run locally on your Mac

For vehicle changes, use **Work → Your Work profile → Edit / change vehicle**
(also available in Account). Approved/submitted profiles ask for confirmation;
saved vehicle changes require replacement vehicle documents and a new review.
**Delete Work profile** opens a typed confirmation and retains Customer and past
records. See [vehicle changes and deletion](../../docs/pickup-identity.md).

Use **Node 24** (selected by the repository `.nvmrc`). Upgrade from Node 22.12.0
before installing mobile dependencies. With nvm installed, run `nvm install`
and `nvm use` from the repository root.

Start the existing backend in one terminal at the repository root:

```bash
npm run dev
```

Open `http://localhost:3000/app`, create a test account if needed, and keep the
server running. Existing accounts still work; no database reset is needed.

In a second terminal at the repository root:

```bash
npm ci --prefix apps/mobile
npm run mobile:start
```

Press **i** for an installed iOS Simulator or **a** for an installed Android
emulator. Xcode/simulator or Android Studio/emulator setup is required respectively.
Use the Expo Go version compatible with SDK 57 for the initial simulator preview;
use development builds when adding native integrations. If the CLI cannot find a
compatible Expo Go client, install the SDK-matched simulator client using Expo's
official tooling. No simulator/device run has been verified in this workspace.

For Android, map the backend port before signing in:

```bash
adb reverse tcp:3000 tcp:3000
```

The development API defaults to `http://127.0.0.1:3000`; iOS Simulator can reach
the Mac at that loopback address. Keep the backend's loopback/Host protection.
Physical phones need a reachable protected HTTPS staging origin; Alibaba setup
remains paused. Do not open the backend to LAN hosts to work around this.

For staging, copy `.env.example` to an ignored `.env` here and set
`EXPO_PUBLIC_API_ORIGIN` to its HTTPS origin, then restart Expo. Public Expo
variables contain no secrets. Enter the invited tester name/key under **Invited
tester?** at sign-in. SecureStore holds that credential separately from the account
password. The app never needs or embeds the gateway's proxy token.

## Verify

From the repository root:

```bash
npm run verify
EXPO_PUBLIC_API_ORIGIN=https://taxi.example.test npm run mobile:verify
```

That example origin is a **compilation fixture**, not a hosted service. Verification
checks native module boundaries, TypeScript, session failure/race cases and exports
iOS/Android JavaScript/Hermes bundles. It does not build or sign an Xcode/Gradle
binary, submit to stores or perform device QA. CI has a separate native job on
Node 24 using the mobile lockfile.

The web/backend uses the locked Google authentication library installed by root
`npm ci`. Native dependencies have their own lockfile and install here. Metro
watches this app and the pure shared package without changing the
root to npm workspaces or hoisting dependencies.

## Google sign-up and sign-in

Mobile 0.4.0 also adds **Forgot password?** and **Account → Your email**.
Both reuse the backend's [account email module](../../docs/account-email.md).
Recovery/verification requests start in the app; emailed links open the responsive
website to finish, then users return to the app. No recovery token is stored in
the native vault or passed through an unverified custom URL scheme. On phones,
use a reachable HTTPS staging origin; localhost links only work on the same computer.

Mobile 0.3.0 adds Google login to configured development builds. It uses a server
nonce and verified Google identity before adopting the existing Taxi Ai device
session. Expo Go keeps password login; its runtime has no Google native module.
Follow [Google setup](../../docs/google-sign-in.md) for client IDs, signing
certificates, server configuration, existing-account linking and device acceptance.
Native Google authentication is not activated by a bundle export alone.

## Structure

| Location | Responsibility |
| --- | --- |
| `app/` | Protected routes, tabs and screens |
| `src/session/` | Account lifecycle and native SecureStore adapter |
| `src/api/client.ts` | HTTPS, bearer transport, one refresh at a time, stale-response rejection |
| `src/booking/` | Ephemeral request controller, address search, route review and status cards |
| `src/onboarding/` | Guided application, form conversion and user-selected file adapters |
| `src/work/`, `src/journeys/`, `src/notifications/` | Native availability, account-scoped journey controllers, chat and optional phone alerts |
| `src/ui/` | Shared visual components and focus-scoped loading |
| `src/assets/vehicles/` | Bundled colour variants; identical to the web icons |
| `packages/shared/src/vehicle-registration.*` | Registration year policy and choice normalisation |
| `packages/shared/src/mobile-contracts.*` and `mobile-booking.*` | Versioned wire types and runtime readers |
| `services/api/src/modules/device-sessions/` | Device token lifecycle and ownership |
| `services/api/src/http/mobile-router.mjs` | Narrow native API surface |

Read [vehicle identity and acceptance](../../docs/vehicle-identity.md),
[the mobile contract](../../docs/mobile-foundation.md) and
[the separate admin plan](../../docs/admin-dashboard.md) before adding workflows.

For the new ride flow, open **Home → Book a ride → Sample journey** while the
backend is running, choose two areas, preview and request. Use a separate approved
driver in native Work or on web to take the request. Open the journey in the app
to negotiate, chat, confirm and complete. Provider and device acceptance steps
are in the [booking guide](../../docs/mobile-booking.md).

## Device review before the next milestone

Use [the signed preview setup and acceptance record](../../docs/device-preview.md)
for installable APK/ad hoc builds, Firebase client configuration, push credentials
and the remaining live-host/device checks.

1. Sign in with the same web account on iOS/Android. Confirm customer/work activity,
   application status and pagination agree with web.
2. Close/reopen, lock/unlock, lose network during refresh, background/foreground,
   rotate, switch account/mode during slow responses and retry an enrollment.
   No prior account data should appear. A lost refresh response may require sign-in.
3. Revoke a phone from `/devices`; its next request must reject access. Check local
   logout and remote-device logout independently.
4. Test small phones and iPad/Android tablets in both orientations, large text,
   screen readers, keyboard avoidance and reachable touch targets. Verify the
   background privacy screen on actual devices.
5. Open the system document picker, cancel, select a PNG/JPEG, rotate and background
   the app. The privacy cover should conceal the application without unmounting the
   navigation stack; returning from the picker must retain the selected file and form.
   Verify cache cleanup, expired/replaced images, offline upload retry, stale edits
   from web, approval and reopening during assigned work.
6. GPS permission is requested only from Go online or Share my location; phone-alert permission only from
   Enable phone alerts. Check that there are no unexpected microphone/camera prompts, credentials
   in logs or success messages after failed network/storage operations.

Before public downloads: finish native ride workflows and validate live recovery email delivery, test signed
apps, complete store artwork/privacy listings, verify app IDs and the owned domain,
connect a production backend and meet pilot gates. Developer accounts/signing are
not configured here. `com.taxiai.app` is provisional; confirm before registration.

After a store listing is public, set its URL in `apps/web/public/app-release.mjs`.
The website Download app section then displays the real link. Until then it says
Coming soon. No APK, TestFlight link or store release is claimed by this milestone.
