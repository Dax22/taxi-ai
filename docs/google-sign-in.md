# Google sign-up and sign-in

Release **0.19.0**, mobile **0.3.0**, schema **14** adds optional Google authentication.
It is implemented for web and native development builds, but is **off until the
owner configures Google OAuth credentials**. No Google project, consent screen,
client credentials or deployed service is created by this repository.

## Account behavior

- **Sign in with Google** creates a customer account on first use, or opens the
  account already connected to that Google identity. The customer can apply to
  drive using the existing vehicle/document workflow.
- Existing password users sign in first and open **Sign-in methods** at
  `/account-access`. **Connect Google** asks for their Taxi Ai password, then the
  matching Google account. Trips, payments, capabilities and vehicle records keep
  their original account ID. Matching email alone never grants access or merges users.
- Google-only accounts have no Taxi Ai password. They use Google on both platforms.
- Google identities are indexed by provider + stable subject, not email. A later
  Google email change does not create another user or silently change contact email.
- **Disconnect Google** requires a working Taxi Ai password, removes the connection
  and signs out all existing web/device sessions. A sole Google method cannot be
  disconnected and strand the user. Release 0.20 adds [recovery](account-email.md)
  for existing password accounts; it does not add a password to Google-only accounts.
- Staff access remains a separate password account. Google cannot grant admin
  capabilities, authenticate an administrator, or bypass driver application review.

Google accounts can use Gmail or another email address. Taxi Ai asks only for
basic sign-in identity: `openid email profile`. It does not request Gmail,
contacts, Drive or Calendar access and does not retain Google access/refresh tokens.

## Local website setup

1. Install the committed dependencies with `npm ci` in the repository root.
2. In [Google Cloud Console](https://console.cloud.google.com/), create/select your
   own Taxi Ai project and configure its Google Auth Platform branding, audience
   and contact details. Use a testing audience with your test Google accounts
   while developing. Complete any requirements shown in your console.
3. Create an OAuth client of type **Web application**. Set this exact authorized
   redirect URI:

   ```text
   http://localhost:3000/auth/google/callback
   ```

4. Open a private `.env` file in the repository root. Copy `.env.example` only if
   `.env` does not already exist; preserve any existing database/runtime settings.
   Fill these values from your Google client:

   ```dotenv
   TAXI_AI_GOOGLE_CLIENT_ID=your-web-client.apps.googleusercontent.com
   TAXI_AI_GOOGLE_CLIENT_SECRET=your-server-only-secret
   TAXI_AI_GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
   TAXI_AI_GOOGLE_NATIVE_CLIENT_IDS=
   ```

5. Run `npm run config:check`. It reports `google=on` without printing credentials.
6. Restart with `npm run dev`. Open **http://localhost:3000/app** and use
   **Sign in with Google**, visible on both the sign-in and registration views.

Use `localhost` for this flow, including when you normally use `127.0.0.1`.
If changing `PORT`, update both the console redirect and `.env` to the same port.
Registration on the existing email/password form continues to work with Google off.
Partial or invalid Google configuration prevents startup; `config:check` explains
the setting without exposing its value. The secret belongs only on the server;
never put it in an `EXPO_PUBLIC_` variable, a screenshot, a PR or a committed file.

The npm development, configuration, administrator and backup commands load `.env`.
Existing environment variables take precedence. Tests deliberately do not load
local OAuth credentials and use disposable test accounts/provider fixtures.

The button artwork is copied unmodified from Google's official
[branding assets](https://developers.google.com/identity/branding-guidelines):
light pill, text included, Android/Web and iOS PNGs at 2× resolution. Files are
served locally and retain their aspect ratio. The Google mark belongs to Google;
use these assets only for the corresponding Google sign-in action.

## iOS and Android development builds

The native adapter uses `react-native-nitro-google-signin`, with Android Credential
Manager and the iOS Google SDK. The SDK is loaded only after a user taps the button
in a configured native build. Email sign-in remains available in Expo Go.

1. In the **same Google project**, create iOS and Android OAuth clients for the
   configured bundle/package ID, currently `com.taxiai.app`. Register the Android
   signing certificate SHA-1 for the build being tested; store signing keys safely.
2. Add both native OAuth client IDs, separated by commas, to the **server**
   `TAXI_AI_GOOGLE_NATIVE_CLIENT_IDS`. Restart the API.
3. In `apps/mobile/.env`, preserve the API origin and add public client IDs:

   ```dotenv
   EXPO_PUBLIC_API_ORIGIN=https://your-private-test-host.example
   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your-web-client.apps.googleusercontent.com
   EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=your-ios-client.apps.googleusercontent.com
   ```

   The web ID must match the server. The iOS ID is used by `app.config.cjs` to
   configure the reversed client-ID URL scheme. No Firebase project is required
   for this explicit OAuth-client setup. Local simulator API settings are covered
   in [mobile setup](../apps/mobile/README.md).
4. Run `npm ci --prefix apps/mobile` from the repository root, then create a
   development build. From `apps/mobile`, `npx expo run:ios` requires macOS/Xcode;
   `npx expo run:android` requires the Android SDK. These commands generate native
   projects locally. Rebuild when changing native OAuth/plugin configuration.
5. Test on a device with Google services and a reachable API. For private staging,
   enter the invited tester access in the app before continuing with Google.

The native API first issues a ten-minute nonce challenge. The native SDK returns a
Google ID token for that nonce, and the backend verifies it before issuing Taxi Ai
device credentials. Google tokens/claims are not stored in the app vault. The vault
retains only the existing Taxi Ai refresh credential and preview access settings.

Expo documents the development-build requirement in its
[Google authentication guide](https://docs.expo.dev/guides/google-authentication/).
The native adapter follows the package's
[backend verification contract](https://react-native-nitro-google-sign-in.github.io/docs/guide/usage/).
Exports are JavaScript/Hermes compilation checks, not signed binaries or evidence
that Google login has run on a device.

## Hosting

The prepared Docker/Compose setup installs locked server dependencies and forwards
the optional Google variables. For Alibaba staging, register the exact HTTPS
`TAXI_AI_PUBLIC_ORIGIN` plus `/auth/google/callback` in Google and set the same
redirect on the server. Keep the existing gateway and invited-tester protection.
Use the host's secret management for the client secret before a public pilot.
This change does not provision Alibaba, open staging access or deploy the app.

## Modular implementation

| Location | Responsibility |
| --- | --- |
| `modules/accounts` | Existing profiles, safe identity mapping, linking and password eligibility |
| `modules/google-auth` | Expiring challenges, web/native use cases, callback and API routes |
| `infrastructure/google-provider.mjs` | Google SDK networking and signed-token verification |
| `infrastructure/google-config.mjs` | Optional, origin-bound runtime configuration |
| `modules/device-sessions` | Issuing and revoking native Taxi Ai sessions after authentication |
| Web `google-auth.mjs` / `sign-in-methods.mjs` | UI controllers with injected transport and views |
| Native `session/google-provider.ts` | Google SDK adapter; no API transport or private storage |
| Native `api/client.ts` | Challenge exchange and existing session/vault lifecycle |

Services receive ports through `application.mjs`; they do not import SDKs, HTTP or
other modules' repositories. The architecture checker permits declared third-party
server packages only in infrastructure/tests. Native dynamic import is restricted
to the single literal Google SDK in its guarded adapter.

Web uses the authorization-code flow with S256 PKCE, nonce and a hashed state
bound to a short-lived HttpOnly SameSite=Lax cookie. The normal session remains
HttpOnly SameSite=Strict; hosted cookies are Secure and `__Host-` prefixed. Only
the fixed callback accepts Google's cross-site return. Start/link/unlink APIs keep
the existing same-origin and CSRF checks. Callback redirects use fixed local
destinations and allowlisted outcomes, never arbitrary return URLs.

The Google library checks signatures and provider/audience constraints; the adapter
also enforces expiry, nonce, verified email and configured presenters. Pending
attempts are consumed before the provider request, bound to their channel, bounded
in count and regularly deleted. Link completion rechecks its original session.
SDK errors are sanitized. Logs never include URLs, headers, codes, tokens or bodies.
See Google's [OpenID Connect flow](https://developers.google.com/identity/openid-connect/openid-connect)
and [server verification guidance](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

## Upgrade and acceptance

Back up with the previous release before starting schema 14 on saved data. The
migration adds identity, password-setting and temporary-attempt tables without
rewriting existing users, passwords, journeys or approvals. Current backups require
schema 16, retain identity mappings and clear pending Google challenges and account-email actions as well as
web/native sessions. Older branches require their own compatible backup/test DB.

Automated tests cover real RSA verification with local keys, expired/mismatched
claims, browser binding, replay, collisions, explicit linking, admin isolation,
native credentials, cancellation, session changes, migration and backup behavior.
Live Google consent, browser redirect/cookie behavior, accessibility and signed
device testing still need your configured OAuth project. An automatic approval
review previously denied the workspace browser preview, so these checks are not
claimed as completed.

Before iOS store submission, add an equivalent privacy-preserving sign-in option
(planned: Sign in with Apple), plus in-app account deletion/recovery. Apple's
[login-services rule](https://developer.apple.com/app-store/review/guidelines/#login-services)
applies to consumer apps using third-party primary login, subject to its listed
exceptions. Google integration alone is not App Store readiness.

Release 0.20 implements mailbox verification and customer/driver password recovery.
Phone verification, account deletion and staff recovery/MFA remain future work.
The next app milestone is the native ride request → fare agreement →
trip → simulated receipt journey against the existing backend. Eats/vendor/courier
modules remain separate product milestones.
