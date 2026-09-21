# Native safety and trusted contacts

This development milestone implements **Section 2A: native mobile safety** on top
of the unmerged `feat/chat-safety-hints` branch. It does not complete native live
tracking/calling, real payments/payouts, or account/staff security (Sections 2B–D).
No merge, hosting change, signed binary, store release or real emergency delivery
is included. The native API remains v1; the database advances from schema 17 to 18.

## What is available

Open **Account → Safety & trusted contacts**, or the **Safety & trip sharing**
button at the top of any journey. The journey button remains available when the
journey read fails; the safety page can still show its local emergency guidance.
Use fictional accounts, contacts and reports.

- Add, edit and remove up to three trusted contacts shared with the website.
  International number format is checked; ownership is not verified.
- On a confirmed active trip, manually select a concern, optional private note and
  optional contacts, then explicitly confirm **Save test SOS**.
- Read your own saved incidents and the existing administrator's recorded review
  progress. The other trip participant cannot read your report or contact list.
- Create, replace and revoke a private trip link for 15, 30 or 60 minutes. Sharing
  it through the phone's operating-system share dialog is a separate user action.
- Read the latest available driver-shared web GPS with its age/accuracy, or an
  explicit unavailable state. Opening safety never requests GPS or microphone access.

**Saving an incident sends no alerts and dispatches no help.** Queued, sending,
delivered and failed contact-alert states are labelled as simulations. An
administrator acknowledging a test record is not a staffed-response promise;
closing a record is not a finding that a person is safe. The possible-crash option
is manually reported, not automatic crash detection. Ordinary journey push alerts
remain a different integration and do not deliver these safety notifications.

The app cannot save an offline SOS. For an actual emergency, use the phone to
contact local emergency services or someone you trust; do not rely on this preview.

## Boundaries and access

`services/api/src/http/mobile-safety.mjs` adapts the bearer-only mobile surface to
the existing safety service. The safety service continues to own contacts, incident
state, server-owned trip snapshots, permission checks, transactions and command
replays. No separate native incident database or duplicate emergency engine exists.
`packages/shared/src/mobile-safety.mjs` validates narrow native projections;
`apps/mobile/src/safety/` owns controller, lifecycle and OS-sharing adapters.

All endpoints below are under `/api/mobile/v1`. Browser cookies and browser-origin
requests do not authorize them. Staff review and notification simulation are not
exposed on this native surface. Writes require a stable idempotency key; the service
revalidates the native credential inside the transaction, including replay.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/safety/contacts` | Own contacts |
| POST | `/safety/contacts` | Add a contact |
| POST | `/safety/contacts/:id/edit` | Edit with the displayed version |
| POST | `/safety/contacts/:id/remove` | Remove with the displayed version |
| GET | `/safety/rides/:id` | Participant's own incident history and link metadata |
| POST | `/safety/rides/:id/incidents` | Manually confirmed test report |
| POST | `/safety/rides/:id/links` | Create/replace with the displayed prior link ID |
| POST | `/safety/links/:id/revoke` | Revoke with the displayed link version |

Native reports include the displayed version of every selected contact. A changed
number or name requires refreshing and selecting again, not silent retargeting.
Editing a phone cancels queued/failed simulation intentions to its previous number.
Existing frozen recipient evidence remains unchanged. Legacy web report payloads
without contact versions remain compatible; native reports require them.

The server records the assigned driver/vehicle and available timestamped GPS, not
client-supplied versions of that evidence. Native responses exclude staff actor
IDs, raw snapshots, session identifiers, document data and credential hashes.
Contact-alert phone numbers are masked in incident views.

## Trip-link lifecycle

Schema 18 adds an exclusive native-device binding alongside existing web-session
bindings. A native link belongs to the **stable device session family**, not its
rotating access token. Routine access refresh therefore does not end the link.
Explicit link revocation, the creating device's server-confirmed logout/revocation,
session expiry, link expiry or trip closure makes future reads unavailable. Another
authenticated device belonging to the same account can revoke or replace the link.
Web/native replacements share the existing one-active-link-per-owner/trip policy.

A random secret is returned only once and only its hash is stored. Replaying a
creation recovers metadata, not the secret. Native controllers keep the raw secret
outside render state, only in memory, and clear it on screen blur/backgrounding,
expiry, revocation, account change, revalidation failure and disposal. It is not
saved to the native vault, logs, URL query strings or notification payloads.

Before invoking OS sharing, the client revalidates the current link and consumes
its local secret. A share-dialog result is **not delivery confirmation**. Creating
another sharable copy after leaving or using the dialog requires explicit
replacement, which also invalidates the previous link. A recipient can copy or
photograph information already shown; revocation cannot recall those copies.

The URL uses the existing `/trip-share#<secret>` viewer. It exposes driver name,
vehicle plate, route and available driver-shared location, not customer identity,
contact lists, incident notes, fare, chat, parcel details or handover codes.
Localhost links are not reachable from other devices. Private staging recipients
must have their own invited preview access; never distribute account credentials.

React Native documents platform-specific [Share](https://reactnative.dev/docs/0.86/share)
and [AppState](https://reactnative.dev/docs/appstate) behavior. The application does
not infer successful human delivery from either a share result or app-state change.
Actual phone/tablet dialogs and background transitions require device acceptance.

## Interrupted requests and private state

Only an explicit confirmation can create an incident or share link. Timers refresh
reads; they never submit reports, retry mutations, share a URL, call a contact or
change trip/fare state. An uncertain command retains its original payload, contact
versions and key in account-scoped memory across native navigation. The user must
choose **Retry the same safety action**; it cannot become a different report.

Backgrounding clears visible contact/report data, drafts and the raw share secret.
A pending command retains only the original private payload needed for explicit
retry. Account removal disposes it. Late responses cannot repopulate a backgrounded
or removed controller. Force-quitting loses pending in-memory commands; reopen
saved records and review their server state before performing a new action.

Offline logout clears local credentials but cannot guarantee immediate server-side
link revocation without a connection. Follow the existing logout warning and revoke
the device from another authenticated session. The original deadline still applies.

## Upgrade and verification

Back up using the installed schema-17 release before upgrading saved data. Migration
018 rebuilds only the trip-sharing table, preserving its existing IDs, secret hashes,
web bindings, history and command references. Accounts, approvals, rides, contacts
and incidents are preserved. Older binaries cannot open the schema-18 database;
use a separate pre-upgrade copy to compare branches. Current snapshot commands revoke
all link/session bindings, including native ones, while retaining private incident
and contact evidence. A backup remains sensitive data, not an anonymized export.

Run `npm run verify` and `npm run mobile:verify`. Added regression tests cover shared
contracts, native/web contact interoperability, report privacy and version races,
link replacement/revocation/refresh/logout/expiry, transaction rollback, restart,
snapshot sanitization, schema-17 preservation, controller retries and late responses,
and navigation wiring. Source assertions and bundle exports are not device QA.
Actual run results and the exact tested commit belong in the pull request.

Before acceptance, test customer and driver flows on iPhone/Android, small screens
and tablets, keyboard and screen readers, OS sharing/cancel behavior, offline/slow
requests, backgrounding during confirmation/sharing, wrong-account navigation,
revoked devices, link expiry and two recipient browsers. Check every alert state
still says simulation and no route, PIN or report leaks into notification previews.

**Outstanding:** real contact verification/delivery and provider callbacks,
operationally staffed incident response, native trip maps/background location and
calling, real payments/payouts, remaining account/staff security, cloud/provider
activation, signed-device acceptance and store distribution.
