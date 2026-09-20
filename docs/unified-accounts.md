# Unified accounts and website modes

Version 0.14.0 implements the first unified-platform milestone for **rides**.
One personal account can use Customer and Work on the website. The native foundation
and driver application now share this account. Taxi Ai Eats, courier/motorbike delivery and My store are still planned. No
vendor, delivery or administrator privilege is available through the mode picker.

## Try it

1. Open `/app` and create an account or sign in. New accounts start in Customer.
2. Select **Apply to drive**. Choose a make, year (2000 onwards), model and colour
   from the dropdowns, enter a fictional plate and select **Continue to driver
   application**. The same account opens Work with these details already filled in.
3. Complete the existing [driver application](driver-onboarding.md). A separate
   administrator must review the documents. Work is available for application
   access while pending; matching requires approval and current documents.
4. Select **Customer** or **Work** at the top of the dashboard. The choice belongs
   to this browser window; it does not change the server session's permissions.
   Session storage remembers the choice on refresh, and sign-out clears it.
5. If Work is online, select **Go offline and switch** or **Stay in Work**.
   The app reads server availability, sends an explicit offline command and
   reads it again. A failure keeps you in Work and shows an error. Another
   window going online again also prevents a false offline confirmation.
6. Open a journey shown in **You have a journey in another mode** to continue it,
   chat or use Trip Safety. Switching does not cancel a saved trip. Finish or
   cancel conflicting work before starting a personal ride, and vice versa.

Use separate browser sessions for the two people in a test trip. A person cannot
be their own driver. Ordinary tabs share the login cookie; tabs may choose
separate modes, but remain the same person. Use only fictional data.

Changing mode clears workspace selections, unsaved forms, route previews,
conversation state, payment details and onboarding/safety views. Reads from an
old mode cannot populate the new one. A write already in flight prevents switching;
uncertain retry keys stay associated with their original mode. Mode switching
never resubmits or accepts a different fare automatically.

Calls and active trip GPS use a separate session client. Switching keeps an
active call, a pending microphone request, and active/pending GPS on their
original journey. Their controls remain visible. The tracking panel identifies
its journey so it cannot be confused with the workspace selection. Ending a
call, stopping GPS, losing permission/session or server lease expiry still uses
the existing cleanup rules. Background browser limitations still apply.

## Storage and compatibility

`010_account_capabilities.sql` is an additive schema **9 → 10** migration:

| Existing record | Result |
| --- | --- |
| Customer | Customer capability; unchanged identity and login |
| Driver, including pending/rejected | Customer and driver capabilities; unchanged driver/application status and documents |
| Administrator | No public capabilities; restricted staff access remains explicit |

`users.role` is retained as a legacy registration classification and the existing
staff marker. It is not the source of public permissions. The API returns
`capabilities` in the account profile and loads the driver profile from its
capability. Capability membership grants application access; `drivers.status`
and document eligibility independently control driving work. Adding a driver
profile does not rotate the session or promote the person to staff.

Existing account IDs, password hashes, sessions, rides, fares, messages, review
evidence, receipts and safety records are preserved. The migration does not
invent approvals, documents, bookings, payments or incidents. Enrollment writes
the profile, capability, retry record and audit event in one transaction.

Before upgrading, stop the server and use the previous release's backup command
with a new destination, as described in [the staging guide](staging.md). Start
this version against the existing database to apply the migration. Do not delete
the database or edit earlier migrations. Current backup/restore commands require
schema 10. To restore an older snapshot, use its matching release, then upgrade
a separate copy. Old binaries refuse schema 10; compare branches using separate
data files. Backup restoration intentionally invalidates sessions and live leases;
normal migration preserves them.

Old registration payloads with `role: "customer"` or `role: "driver"` still work;
new registration omits `role`. Old driver registration creates both capabilities
and a pending application. Old unfiltered ride-list/history clients remain
compatible. The website now explicitly requests its mode's records. The native
session/authentication contract is the next milestone, not part of this release.

## API additions

All mutations require the existing same-origin, session, CSRF and rate-limit
checks. Enrollment also requires a unique `Idempotency-Key`.

| Endpoint | Contract |
| --- | --- |
| `POST /api/auth/register` | `name`, `email`, `password`; optional legacy `role` and driver `vehicle` |
| `GET /api/session` | Profile includes `capabilities: ["customer", "driver"]` as applicable; approval is separate |
| `POST /api/account/driver-profile` | `{ "vehicle": { "make": "Toyota", "model": "Corolla", "year": 2020, "colour": "Blue", "plate": "TEST-001" } }`; returns own `user` and `replayed`; legacy model/plate-only input remains supported |
| `GET /api/rides?mode=customer` | Own passenger rides, no available work; `activeElsewhere` contains own work references/statuses |
| `GET /api/rides?mode=work` | Own assigned driver rides and eligible nearby requests; own personal requests are excluded from available work |
| `GET /api/rides/history?mode=customer&before=:id` | Passenger history; optional cursor must belong to the selected mode |
| `GET /api/rides/history?mode=work&before=:id` | Driving history under the same account; private earnings remain separately scoped |

Omit `mode` for the legacy combined participant list. Unknown modes are rejected;
requesting Work without its capability is forbidden. A mode does not change the
actor on a write: the server derives the account from its session and checks the
trip's stored customer/driver IDs. Only the passenger may confirm/pay and only
the assigned approved driver may depart/arrive/start/complete. Customer access
continues if that person's unrelated driving application is pending or rejected.
The SOS reporter role is the person's role on that trip.

A person cannot claim their own request. Personal requested/negotiating/agreed or
active journeys block going online and claiming work. Driving negotiations,
agreements and active journeys block personal requests/confirmation. Active
online availability must be stopped before a personal booking. Checks run in
the ride/availability write transaction, so concurrent commands cannot claim
both roles. Expired personal requests do not keep a worker busy indefinitely.
Existing same-role fare-agreement behavior is retained: an unconfirmed agreement
is not a booked trip, and confirmation rechecks both participants' capacity.
Cross-service reservations will be added with delivery workflows.

## Verification and remaining review

`npm run verify` covers the full existing suite plus schema-nine preservation,
atomic/retryable enrollment, unauthorized grants, two-capability trip/payment
ownership, pending-driver passenger communication, history/cursor separation,
workload races and mode/availability transitions. DOM fixtures bind controls to
the actual HTML. These are automated fixtures, not browser/device acceptance.

Manual browser review remains required; the available cloud browser cannot open
the local preview. Test the following on desktop and phone/tablet widths:

- Keyboard through Customer/Work, enrollment and offline confirmation. Check
  focus, labels, contrast, disabled states and errors at 200% zoom.
- Enroll an existing customer while signed in; approve using a separate operator;
  book and drive different trips under the same account and check each history.
- Keep a call and GPS sharing running, switch modes, then reopen the original
  trip and Trip Safety. Verify controls act on the named journey and no second
  microphone/GPS permission is requested. Test delayed permission as well.
- Go online in another tab, switch to Customer, interrupt the offline response
  and confirm the app stays in Work until the server confirms offline.
- Delay a ride/history/payment/application response during switching; old content
  must not reappear. Start a payment/upload, then try to switch while it is pending.
- Refresh, sign out/in, expire a session and change the shared cookie in another
  tab. No prior person's information or device activity should remain.

This remains a development preview: payment, SOS notifications and transport
operations are not live. Alibaba hosting setup remains paused.
