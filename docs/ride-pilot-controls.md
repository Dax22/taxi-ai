# Passenger ride pilot controls

These controls prepare an **invited, test-only** passenger pilot. The hosted
application remains `TAXI_AI_MODE=staging`: fares are illustrative, ride records
say `isDemo: true`, payment simulation is disabled on the host, and completing a
trip creates an unpaid simulation record. Enabling requests here does **not**
enable live passenger transport, dispatch, real payment, refunds or payouts.

## Set the test boundary

In `deploy/staging/.env` (or `deploy/scale/.env` for the PostgreSQL staging
template), keep the default `TAXI_AI_RIDES_PAUSED=true` until the private HTTPS
deployment is ready. Choose a **conservative rectangle entirely inside** the
approved test area, then set:

```dotenv
TAXI_AI_RIDES_PAUSED=false
TAXI_AI_RIDE_PILOT_BOUNDS=<minLat,minLng,maxLat,maxLng>
```

The values are decimal degrees with up to six decimal places. The operator
provides the actual coordinates; this repository does not invent permit boundaries.
Hosted staging refuses to start with unpaused passenger requests and no bounds.
Use `npm run config:check` inside the selected deployment before starting it.
See [private staging](staging.md#reference-deployment) for the gateway, tester
credential, persistent storage and deployment commands. Neither the SQLite nor
the PostgreSQL template has been deployed to a host by this change.

For passenger requests, the server checks the **entire raw provider route**, as
well as its pickup and destination, against the configured rectangle when the
quote is made. Only a server-owned coverage result is stored with the quote; it
is excluded from browser/mobile responses. Booking checks that result against
the **current** rectangle. Quotes created before an area change must be previewed
again. A route that crosses the rectangle boundary is refused even if its two
endpoints are inside. The rectangle is a technical guard, not a determination
that a route is legally permitted; the operator must choose its bounds accordingly.

If `TAXI_AI_RIDES_PAUSED=true`, new passenger requests return `RIDES_PAUSED`
(HTTP 409), including previously saved quotes. The existing ride can still be
claimed, negotiated, completed or cancelled. To pause on an existing host, change
the environment value and recreate **every API process** so no process keeps the
old setting. With the single-process staging template:

```bash
docker compose -f deploy/staging/compose.yml --env-file deploy/staging/.env up -d --force-recreate app
```

For `deploy/scale/compose.yml`, recreate both `api-a` and `api-b` after updating
the shared environment. Confirm the new process has started and try a new test
request; a local file edit alone does not change running processes. This is a
restart-operated pause, not an instantaneous remote emergency control.

The policy runs only after the booking service identifies a **passenger** request.
Standard-car parcel bookings and other courier categories use the same route
planning service, so their quotes remain available. Eats does not use this policy.
Hosted staging already forbids sample-area bookings for both passenger and courier
requests; local development keeps its sample workflows by default.

## Acceptance before inviting testers

1. Confirm the HTTPS origin and tester gate, a persistent database and a restore
   drill. Use fictional accounts and separate customer/driver devices.
2. With rides paused, create a route preview and confirm web and native booking
   report `RIDES_PAUSED`; confirm a parcel and an Eats order still work.
3. With the configured bounds and rides unpaused, confirm an in-area test route
   works. Test an out-of-area pickup, destination and route crossing the boundary.
4. Pause during an active test ride. Confirm a saved quote cannot make a new ride
   and the active ride can close or cancel. Confirm a changed rectangle invalidates
   prior quotes.
5. Check GPS and provider routes on actual iPhone and Android devices, over mobile
   data. Verify denial, stale fixes, app backgrounding and interrupted requests.

No mode in this release turns a simulation payment into a real charge. Before
real rides, add a separate production payment and settlement path, validated
driver/vehicle operations, staffed support and safety response, and a production
deployment review. Do not copy preview payment records into real accounting.
