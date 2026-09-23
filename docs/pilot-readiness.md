# Journey verification and private-pilot preparation

This milestone verifies the existing ride service from registration to a simulated
receipt and fixes dashboard account isolation. It does not enable a passenger
pilot. Payments still move no money, driver approval is test access, and hosting
on Alibaba Cloud remains paused.

## Run the focused check in VS Code

From the repository root, with Node 22.12 or later:

```bash
npm run test:journey
```

This starts a disposable loopback HTTP server and a temporary SQLite database,
creates fictional customer/driver/administrator accounts, runs the real operator
bootstrap command against that temporary database, and removes the database at
the end. It uses the shipped browser API client with separate simulated cookie
jars, the real server, permissions, transactions and persistence. It never writes
to your normal `data/taxi-ai.sqlite`, contacts a map/payment/emergency provider,
sends messages to real people, or creates accounts in a deployed environment.
The generated test accounts are not available in your normal `/app`.

The command checks:

1. Registration, administrator setup, revoked bootstrap session, pending-driver
   restrictions, private document submission and recorded manual review before approval.
2. Explicit availability, nearby matching, exclusive assignment, private chat,
   read acknowledgement and limited administrator message-report review.
3. Offers and counteroffers, rejection of a stale acceptance, exact agreed kobo,
   customer booking, PIN privacy, a wrong PIN and recovery after server restart.
4. Trip completion and cleanup of availability, call invitations and shared
   location. Location and call state are fixtures; no microphone/GPS is used.
5. Failed payment, a fresh attempt, a saved success whose response is lost, then
   restart and retry of the original command without a second receipt or payment.
6. Identical participant receipts, exact driver earnings, limited administrator
   payment records, outsider rejection, cancellation without billing, a new
   request, logout protection and saved-receipt recovery after login.

Node client fixtures also cover customer/driver/admin rendering, original fare
versions, session expiry, account changes during reads, delayed responses and
actions, repeated clicks and recovery when an action saves but its refresh fails.
They are not browser automation or visual/device tests.

Run `npm run verify` before uploading changes. The focused tests are also included
in the normal full suite and the existing Node 22.12/24 CI matrix. No database
migration was added by the journey-verification release. The subsequent
[driver-onboarding release](driver-onboarding.md) adds schema 8, followed by
[Trip Safety](safety.md) at schema 9 and [unified accounts](unified-accounts.md)
at the current schema 10.

## Fixes in this milestone

`dashboard/page-controller.mjs` owns session, refresh and action coordination;
`dashboard.mjs` wires DOM and feature adapters. Changing account, role or session
clears the old dashboard and feature contexts before further network work. A
second session read checks that parallel dashboard reads belong to the same
session before publishing them. Authentication/access failures clear private
state even if a subsequent refresh cannot connect.

Actions waiting for an existing refresh are cancelled if that refresh changes
the session. They are never silently run for the replacement account. API
responses from a reset session cannot update server time or remove a newer
command's retry key. Fare/PIN controls, old identity/vehicle text, history and
selected trip state are cleared on reset. Refresh is a read operation and cannot
display the misleading "action was saved" message on a read failure.

## Manual acceptance session

Use fictional details. Start `npm run dev` and open `http://localhost:3000/app`.
Follow [the account setup](../README.md#set-up-the-first-administrator-when-needed)
for a separate operator. Use different browser profiles or a normal/private
window for the customer and driver; ordinary tabs share an account cookie.

| Scenario | Expected result | Status in this environment |
| --- | --- | --- |
| Customer + approved driver, sample Wuse II to Maitama | Driver explicitly goes online; both negotiate and see the same agreed fare | HTTP/client fixtures pass; browser review pending |
| Booking to completion | Only customer sees PIN; wrong PIN is rejected; trip progresses in order | HTTP/client fixtures pass; browser review pending |
| Payment failure, retry, receipt and earnings | Clear simulation labels; one paid record; receipt amount equals the fare | HTTP/client fixtures pass; printing pending |
| Server restart and sign-in again | Saved trip, chat and receipt remain available only to participants | HTTP/client fixtures pass; browser review pending |
| Two ordinary tabs change to a different account | Old trip, plate, fare, PIN, chat, location and receipt disappear on the next detected session change | Client fixtures pass; browser review pending |
| Slow/offline connection during account change or refresh | No previous account data returns; no queued command runs as the new account | Client fixtures pass; browser review pending |
| Keyboard and 390/768/1440 px layouts | Forms, errors and controls remain usable without overflow | Pending real browser review |
| Live Nigeria GPS and maps | Explicit consent; denied/stale fixes handled; correct locations/routes | Pending in-area device/provider review |
| Two-way audio on different networks | Call/answer/mute/end work and microphone stops on logout | Pending configured TURN and device review |
| Print / Save as PDF | One readable receipt, with simulation notice and correct amount | Pending real browser review |

For each manual row, record pass/fail, device/browser, observed behaviour and the
GitHub commit in the PR. Do not include account passwords, session cookies,
real identities, real coordinates or unredacted conversations. The existing cloud
browser restriction prevents local preview review here; no alternate browser,
tunnel or file-preview route is used to bypass that restriction.

## Conditions before inviting real passengers

The local suite is a development check, not an operational readiness certificate.
Complete the following separate milestones before a real ride pilot:

- Review the completed GitHub change stack and select the release to deploy.
- Deploy the private HTTPS preview on the chosen Alibaba host; validate access,
  persistent storage, operational monitoring and a backup/restore drill.
- Implement and validate identity/driver/vehicle verification and account recovery.
- Integrate and verify a real payment provider in its test environment before
  enabling charges; handle authenticated callbacks and reconciliation.
- Provision production mapping, notification delivery and voice relay capacity;
  complete physical-device and network checks.
- Connect the implemented test SOS, trusted contacts and controlled incident records
  to verified delivery, staffed response and agreed emergency-service escalation.
  The Trip Safety preview simulates notifications; no police or contact messages are sent.

Automatic crash detection and native background tracking remain later mobile
work. Taxi Ai Eats, courier and autonomous-service plans are unchanged.
