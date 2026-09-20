# Trip Safety preview

Version 0.13.0 adds trusted contacts, manual test SOS, private incident review,
simulated contact notifications and expiring trip links. Everything runs locally
without provider credentials. The responsive web screens support customer, driver
and administrator accounts. Browser/device acceptance is still pending.

**No messages or calls are sent to anyone.** No police, emergency service or
trusted contact receives a notification. Saving, acknowledging or closing an
incident does not dispatch help. For an actual emergency, use your phone to
contact emergency services or someone you trust. Use fictional contact details
and reports for this preview.

## Try the workflow

Run `npm run dev`, open `/app` and use separate browser profiles for customer,
approved driver and administrator. Follow the root README to create accounts,
approve the driver and confirm a test booking. Hosting is not required.

1. In **Trusted contacts**, save up to three fictional contacts. Use international
   format, such as `+2348000000000`; format validation does not verify ownership.
2. Select a confirmed active trip. In **Trip safety**, choose a concern and optional
   note. Explicitly select any contacts for simulated alerts and choose **Create
   test SOS**. No contacts or GPS are required. The report appears below the form.
3. Sign in as the administrator in a separate session. In **Safety incidents**,
   open the report, inspect its recorded trip details, add an action note and
   choose **Acknowledge test incident**. Acknowledgment is recorded, not a response
   promise. Filter open, acknowledged, closed or all incidents; pages contain 20.
4. Locally, simulate sending followed by delivery or failure. A failed alert can
   be queued again, up to three attempts. Every transition stays in its history.
   Record another administrator note to close the incident. Closing cancels
   queued/failed alerts; a simulated in-flight alert can still receive its outcome.
5. On the customer or driver trip, choose a 15, 30 or 60 minute private link and
   copy it. Open it in another browser session on the same computer. The viewer
   shows the route, driver name, vehicle/plate and available driver-shared location.
   Revoke or replace the link and refresh that viewer: access ends. Completion,
   cancellation, owner sign-out/session expiry and the deadline also end access.

Only local administrators can change simulated delivery statuses. Private staging
can save/view test records and links, but notification simulation writes return
403, including replay attempts. Its invited-tester gateway also protects trip-link
pages and reads. A localhost link is not remotely reachable; a staging recipient
must already have their own preview access. Do not share account credentials.

## Incident and contact rules

- Customers and drivers own separate contact lists. Administrators cannot list
  another account's contacts. Contact numbers are never added to public profiles.
- An SOS belongs to its reporter. The other trip participant cannot read it or
  discover it through their trip safety endpoint. Administrators can inspect
  explicit incidents; the queue itself omits report notes, location and contacts.
- A report is available from confirmed booking through trip completion/cancellation.
  A driver losing eligibility for new work can still raise an SOS on an existing
  active trip. Completion does not automatically resolve a safety incident.
- One unresolved report per reporter/trip prevents duplicate open cases. A test
  limit of 20 total reports per reporter/trip bounds history. Raising reports never
  changes fares, payment, booking or device permissions.
- The server freezes the trip reference, assigned driver ID/name, assigned vehicle
  model/plate, route labels, reporter and recorded-at time. It rejects client-supplied
  versions of that packet. The latest available driver-shared GPS includes capture
  time, accuracy, source and a stale flag after 30 seconds. An expired/stopped share
  yields no location. SOS never starts GPS or infers a position from the pickup.
- Explicit selected-contact snapshots, queued notifications, incident history,
  audit codes and retry keys commit together. An injected write failure rolls all
  of them back. Contact removal cancels queued/failed test alerts and clears its
  active-list name/phone. Recipient snapshots in prior incidents are retained.
- `open → acknowledged → resolved` requires administrator notes and exact versions.
  Stale screens get a conflict; no automatic resubmission against a newer version.
  The `resolved` code means the test record was closed, not that danger has ended.
- Notification states are `queued → sent → delivered/failed`, with `failed → queued`
  retries while the contact and incident remain active. A queued attempt may fail
  before sending. Sending/failure from queued consumes one of three attempts.
  Each transition is explicitly labelled as simulated. No worker or delivery
  provider consumes these rows.

## Private trip links

Each link uses a server-generated random 256-bit secret. Only its SHA-256 hash is
stored, alongside the owner session hash. A link grants a limited trip read, not
account access. It never reveals contact lists, incident reports, private notes,
driver licence/documents, customer identity, fare, pickup PIN or chat. The vehicle
plate and last shared location are deliberately disclosed to anyone with the link.

The URL puts the secret in a fragment (`/trip-share#…`), not a path or query. The
viewer immediately removes the fragment from its current history entry and sends
the token in a bounded same-origin JSON POST. It keeps the token only in memory;
no localStorage or token recovery API exists. A successful create returns the raw
secret once. A lost create response can be safely retried, but returns only link
metadata: the user must explicitly replace it to obtain a new URL. Replacement
checks the currently displayed link ID and revokes the old link atomically.
There is one active link and at most 30 created links per owner/trip.

The view polls every 10 seconds while visible; hide/network failure clears the
display. Revocation is enforced on every read, so an open viewer clears on its
next check. Expiry also clears the visible page using server-relative time.
Closing the page discards the token; a browser reload needs the original link.
Recipients can still copy or photograph already disclosed details. Revoking a
link cannot recall those copies or clear a recipient's clipboard.

## HTTP contract

All account routes require an authenticated session; writes also require CSRF,
same origin and an actor-scoped `Idempotency-Key`. Responses carry `viewerId` so
the client can reject private responses if another tab changes the account.

| Method / route | Permission and input |
| --- | --- |
| `GET /api/safety/contacts` | Customer/driver; own active list |
| `POST /api/safety/contacts` | Own list; `{name, phone}` |
| `POST /api/safety/contacts/:id/remove` | Owner; `{expectedVersion}` |
| `GET /api/safety/rides/:id` | Assigned participant; own reports and active link metadata |
| `POST /api/safety/rides/:id/incidents` | Assigned reporter; `{kind, note, contactIds}` |
| `GET /api/safety/incidents/:id` | Reporter or administrator |
| `GET /api/admin/safety?status=open&before=:id` | Administrator; cursor and filter |
| `POST /api/admin/safety/:id/review` | Administrator; `{expectedVersion, decision, note}` |
| `POST /api/admin/safety-notifications/:id/simulate` | Local administrator; `{expectedVersion, outcome}` |
| `POST /api/safety/rides/:id/links` | Assigned owner; `{minutes, expectedShareId}` (null for first link) |
| `POST /api/safety/links/:id/revoke` | Owner; `{expectedVersion}` |
| `POST /api/trip-share/view` | Bearer secret in `{token}`; limited read; no account session required |

The bearer-read exception is limited to that final read endpoint: no account
mutation or account data is exposed. It retains Host/Origin/JSON checks, a 1 KiB
body limit, 30 reads/minute/IP, no-store responses and the staging gateway. Invalid,
expired and revoked secrets produce the same unavailable response. Operational
logs use coarse route categories, not request URLs, tokens, bodies, notes or GPS.
The authorization and logging design draws on the [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
and [logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html);
these references do not establish a security certification.

## Migration, retention and recovery

`009_trip_safety.sql` adds seven tables without modifying existing accounts,
documents, trip snapshots or payments. Schema 8 → 9 and repeat startup are tested.
Take a backup using the matching previous release before upgrading saved data;
current backup/restore commands require schema 10; see [unified accounts](unified-accounts.md). Older binaries reject this file.

Snapshots revoke trip links and remove both link/session hashes. They retain
contacts, frozen incident locations, original recipient names/numbers, notes,
action history and simulation/retry records. Restoring does not send messages,
restart GPS or revive link access. These snapshots are **private persistent data**,
not anonymised exports; the app does not encrypt them. Restrict database/backup
access and use fictional data. Automated deletion/retention and incident exports
are not implemented; define them before storing real passenger safety records.

## Verification and outstanding review

`npm run test:safety` exercises HTTP permissions, contact limits, frozen packets,
duplicate/stale writes, transaction rollback, administrator pagination, retries,
hosted simulator denial, link expiry/revocation/sign-out/completion, GPS freshness,
restart, migration, backups, delayed client responses and DOM form behaviour.
`npm run verify` includes these plus the existing journey regressions.

Automated Node/DOM fixtures are not real browser or device QA. Local preview access
was blocked by the available cloud browser. Before acceptance, manually check:

1. Customer/driver/admin workflows at 390, 768 and 1440 px, keyboard focus, labels,
   status announcements and long notes/phone numbers. Reports must display as text.
2. Polling preserves unfinished notes and contact selections; account switching,
   sign-out and delayed replies clear the previous account's private data.
3. Private-link creation, clipboard fallback, original-link reopen after reload,
   two recipients, replacement, expiry, sign-out and trip completion. Test the
   invited-tester gate on a private HTTPS preview when hosting is available.
4. GPS unavailable/denied/stale/stopped cases show truthful timestamps or no location.
   A report still saves without GPS or contacts. Neither SOS nor links start GPS.
5. All notification outcomes remain visibly simulated. Check failed retries and
   cancellation after contact removal or case closure. Receipt printing must not
   include trusted contacts or safety reports.

Real notifications, verified emergency contacts, staffed response, authenticated
provider delivery callbacks and agreed emergency-service escalation are separate
production work. Native crash sensing, unusual-route detection and evaluated AI
assistance follow reliable mobile signals and operational review. No autonomous
agent decides that an emergency is resolved or contacts police in this release.
