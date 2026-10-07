# Mobile Operations

`/admin/mobile` is the privacy-limited operational view for Taxi Ai's installed
iOS and Android applications. It is available only to staff with `mobile.read`;
device revocation additionally requires `mobile.manage`. Owner and Operations
roles receive those permissions by default.

## What it monitors

- active native device sessions and last session refresh
- signed-build adoption: platform, app version, native build number, EAS build ID,
  build profile and Git commit
- passive device capability state: foreground location, background location and
  notification permission (`granted`, `denied` or `unknown`)
- authoritative server push registration/job status
- active ride/Eats location-share freshness, without exposing coordinates
- active scoped background-location grants
- sampled coarse mobile API request latency and 4xx/5xx rates

A signed-in foreground mobile app sends a passive device-health heartbeat when the
session becomes active and approximately every five minutes while it stays active.
The heartbeat does **not** request new OS permissions, start GPS, start background
tracking or enable push.

## Privacy boundaries

Mobile Operations does not persist or display:

- access/refresh credentials
- Expo push tokens
- Apple/Google credentials or signing material
- request bodies, search terms, route IDs or URL query values in API samples
- GPS coordinates or GPS history
- contacts, photos, microphone content or arbitrary device logs

Exact active-journey location access remains in the existing audited transaction
location workflow. Mobile Operations shows only freshness buckets: recent (<30s),
stale (30–59s) and expired (60s+). An expired/stale state does not establish where
a person currently is.

## Retention and sampling

- device-health rows are retained for at most 45 days after their last report
- mobile API samples are retained for 7 days
- every mobile API error sample is recorded
- successful mobile API requests are sampled; default is 1 in 20
- the admin view reads at most 500 active device rows and 5,000 API samples

Configure success sampling with:

```text
TAXI_AI_MOBILE_API_SAMPLE_EVERY=20
```

Valid range is 1–1000.

## Release policy monitoring

Optional environment values mark installed reporting devices that are below a
configured minimum:

```text
TAXI_AI_MOBILE_MIN_IOS_BUILD=
TAXI_AI_MOBILE_MIN_IOS_VERSION=
TAXI_AI_MOBILE_MIN_ANDROID_BUILD=
TAXI_AI_MOBILE_MIN_ANDROID_VERSION=
```

These values are **monitor-only** in this release. They do not block a device,
force an update, revoke a session or change API authorization. A future forced
upgrade policy should be implemented separately with an explicit customer-facing
upgrade response and rollout/rollback controls.

## Device revocation

Owner/Operations staff can revoke a native session from Mobile Operations. The
command is idempotent and audited. Revocation removes that session's push
registration and the existing database lifecycle invalidates scoped native
background-location authority. The action does not remotely enable/disable phone
settings or inspect local phone data.
