# Native accounts and mobile API v1

Implemented in release 0.15.0, schema 11. Existing account IDs, password hashes,
cookie sessions, approvals, trips and history are preserved. Native sessions are
additive. Earlier releases refuse this database; compare branches using separate
databases. Sanitized snapshots clear native credentials, browser sessions and live
leases without changing source data.

One iOS/Android client serves Customer and Work. It signs in to an existing web
account, displays saved activity, starts an optional driver profile and shows its
application status. Document uploads/review stay on web. UI mode selection never
grants privileges: the server reloads capabilities and enforces existing resource
rules. Staff cannot use native sessions.

## Session contract

- First-party password sign-in reuses existing verification. This prototype
  protocol is not OAuth. Evaluate managed identity/authorization-code + PKCE,
  recovery and stronger verification before public operation.
- Random 256-bit opaque credentials; database stores SHA-256 hashes only. Access
  expires after 10 minutes. Refresh families expire after seven inactive days and
  absolutely after 30 days. Maximum five active devices; names are user labels,
  not hardware attestation.
- Every refresh rotates access and refresh credentials in one transaction. Used
  refresh hashes stay associated with the family. Reuse revokes that family and
  commits before returning 401. Other devices and web cookies remain separate.
  Staff promotion revokes native sessions too.
- Refresh token and preview key use Expo SecureStore; access token, account and
  loaded activity stay in memory. Passwords are never saved. iOS uses
  WHEN_UNLOCKED_THIS_DEVICE_ONLY; the plugin excludes Android SecureStore data
  from backups. Uninstall is not server revocation.
- One client refresh at a time; late responses cannot cross logout/account changes.
  Storage write failure attempts revocation and clears local identity. Network
  failure keeps the refresh token for retry. If the server rotated but its response
  was lost, retry detects reuse and asks for sign-in. No replay grace or plaintext
  server refresh storage is introduced.
- Logout clears local state even offline and reports unconfirmed server revocation.
  Web `/devices` can revoke lost phones. Maintenance purges expired/revoked families
  and hashes. Audits retain references, not credentials.
- Native APIs require Bearer authorization and ignore browser cookies. Browser
  Origin/Sec-Fetch-Site headers are rejected. Cookie APIs retain exact-origin/CSRF
  checks; no permissive CORS policy is added.
- Staging keeps trusted HTTPS proxy/Host checks. Native requests additionally carry
  the invited-tester Basic credential in `X-Taxi-Ai-Preview-Access`, leaving
  Authorization for the account bearer. Only mobile v1 paths accept that preview
  header; it cannot authorize web/staff routes. The proxy token stays server-side.
- HTTPS outside local development; simulator HTTP is limited to localhost and
  127.0.0.1. Credentials never appear in URLs. Requests disallow redirects where
  supported by the transport; verify platform redirect behaviour during device QA.

Rotation/replay principles: [RFC 9700 section 4.14](https://datatracker.ietf.org/doc/html/rfc9700#section-4.14).
Native storage behaviour: [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/).

## Versioned routes

All paths below start with `/api/mobile/v1`. Success JSON includes `apiVersion: 1`
and integer `serverNow` in milliseconds. Errors retain `{error:{code,message}}`
and meaningful HTTP status; no raw exceptions or credentials. Client readers
validate success envelopes and consumed fields.

| Method/path | Input | Output / restriction |
| --- | --- | --- |
| POST `/auth/login` | email, password, deviceName | user/credentials; personal accounts only |
| POST `/auth/refresh` | refreshToken | rotated credentials and current user |
| POST `/auth/logout` | refreshToken | idempotent family revocation, including after access expiry |
| GET `/session` | Bearer access | current user and sessionId |
| GET `/activity?mode=customer` or `work` | optional `before` history cursor | current/history summaries, nextBefore, own activeElsewhere references |
| GET `/driver/application` | Bearer access | own status, eligibility, vehicle and document count |
| POST `/account/driver-profile` | vehicle `{model,plate}`, Idempotency-Key | pending driver profile; cannot self-approve |
| GET `/devices` | Bearer access | own active device labels/times, current-device marker |
| POST `/devices/:id/revoke` | empty JSON object | own device only; next access/refresh fails |

Web recovery uses cookie/CSRF-protected `/api/account/devices` and
`/api/account/devices/:id/revoke`. Unknown native paths do not fall through to web
routes. No native admin, payment, trip mutation, media, location, safety or document
download endpoint ships in this version.

Runtime contracts and TypeScript declarations live in
`packages/shared/src/mobile-contracts.mjs` and `.d.mts`. Summaries omit contacts,
pickup PINs, private documents, detailed coordinates and safety records. Fares use
integer kobo; null means no agreed fare. `isDemo` remains visible. History uses
existing 20-row bounded pagination and participant/mode-scoped cursors. Additive
fields are tolerated; breaking semantics require another API version and a client
migration/support policy.

## Verification and next work

Tests cover hashed storage, restart persistence, exact expiry, concurrent refresh,
replay, device/account scope, staff exclusion, enrollment, browser isolation,
protected staging and sanitized snapshots. Native tests cover single-flight refresh,
late reads/login, storage failure, offline logout/restore, origin binding and
incompatible responses. CI type-checks and exports both platform bundles. No signed
binary or simulator/device run is verified here; follow the mobile README checklist.

Next: native booking through trip completion, negotiation, active-trip context,
chat/calls and cancellation using existing server invariants. Add media/GPS/push
permissions only when those features are implemented and device-tested. Real
payments, staffed safety and separate admin access remain pilot gates.
