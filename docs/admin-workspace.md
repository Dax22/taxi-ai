# Admin operations and case management

This release extends the existing staff console at `/admin` with scoped staff
membership, authenticator verification, an operations queue and support/safety
case management. Membership does not change a person's customer or driver
capabilities. Staff tools use authenticated browser sessions; native access
tokens do not authorize administrative endpoints.

## Staff access

| Role | Access |
| --- | --- |
| Owner | Staff management, access audit, operations, account/trip reports, analytics, support and safety cases, and existing administrative reviews |
| Operations | Operations queues and trip reports |
| Support | Support cases and account/trip reports |
| Safety | Safety cases and account/trip reports |
| Finance | Aggregate analytics |

An owner assigns an existing registered account a role and supplies a reason.
Role changes and revocations take effect on subsequent requests. The browser
must refresh its permission-dependent navigation after a change. The last
active owner cannot be removed through the console. Owner access is reserved
for operator-bootstrapped administrators; the console cannot turn an ordinary
customer into an owner. The existing bootstrap command creates the first
administrator only; additional owner provisioning is not exposed here.

Staff membership is separate from the older `users.role='admin'` flag. Existing
administrators become owners during migration, preserving the established
bootstrap process. A revoked membership overrides an old administrator flag.
New support, safety, operations and finance members remain ordinary accounts
for passenger/driver features and receive only the permissions above.

Authenticator enrollment requires the account password and confirmation of a
six-digit code. Once enabled, verification is required for administrative
operations even when the user signs in through the ordinary account page.
Verification is bound to the browser session and expires after 15 minutes;
role/factor changes invalidate previous verification. An unconfirmed setup
expires after 10 minutes. The deployment can require enrollment for every staff
member. Authenticator secrets must be encrypted with a persistent deployment
key; keep that key with the recoverable infrastructure secrets. Set
`TAXI_AI_STAFF_MFA_KEY` to 64 hexadecimal characters and
`TAXI_AI_STAFF_MFA_REQUIRED=true` to enforce enrollment. Local development
defaults to optional enrollment for existing test administrators.

The searchable access audit records staff changes and reasons together with
recorded administrative actions. It is not a transcript of every page viewed
or a replacement for infrastructure request logging. Staff
must never place passwords, authenticator secrets or payment-card information
in reasons or case notes.

## Operations

The operations page supplies bounded, cursor-paginated queues for waiting rides,
active trips, available drivers and delayed Eats orders. Each response has an
`asOf` timestamp. These are observations from the application's stored state;
refreshing the page does not contact drivers or guarantee a new GPS reading.

Waiting requests exclude expired requests. Active trips exclude completed and
cancelled trips. Driver availability requires current eligible availability
and an unexpired session/lease, and excludes drivers already occupied by work
or a pending dispatch offer. A stale last position must not be presented as a
live location. The operations response does not disclose exact GPS, private
home-kitchen addresses, passenger names, email addresses or pickup PINs.

Matching measurements use an explicit 24-hour interval and count offers rather
than unique requests; pending offers past their expiry count as expired even
before maintenance updates their stored status. Average matching time includes
the corresponding matched-request count. Queue region/status filters and the
scope of headline counts are stated separately.

Delayed Eats rows use fixed stage-age thresholds to identify records for staff
attention. They are operational reminders, not delivery-time commitments or
proof a vendor/courier has done something wrong. Staff must inspect the order
before taking action.

## Cases

Support and safety are distinct queues. Support membership does not grant
access to safety evidence. Assignment, status changes, notes and escalation
are recorded as case events. Updates require the current case version and an
idempotency key so a stale page cannot silently overwrite another agent's
work and a repeated request does not create duplicate actions.

Linked safety records keep their own incident status. Closing a case must not
silently declare an unresolved source incident resolved. Source incidents and
case workflow are synchronized through the service boundaries, with reopening
and incompatible status changes checked on the server.

Priority determines the first-response target. Reducing priority cannot silently
extend an outstanding target; reopening explicitly starts a new one. These are
internal follow-up targets rather than promises to passengers.

The workspace records staff action and follow-up. It does not dispatch police,
ambulances or other emergency services. Existing simulated notification modes
remain labelled as simulation; a saved case or escalation is not a delivery
receipt. Family Safety sharing does not confer unrestricted staff access to
passenger locations, private family grants, contacts or trip PINs.

## Deployment and verification

Apply the additive SQLite and PostgreSQL migrations through the application's
normal migration command. Existing accounts, rides, fares and case source
records must remain intact. Restored snapshots retain staff membership and
enrolled-factor policy, but clear browser/device sessions, pending enrollment
and temporary authenticator verification. Restore the matching encryption key
before using enrolled authenticators against a restored database.

Automated tests cover HTTP permission enforcement, browser/native separation,
authenticator verification, case version/idempotency behavior, operations
response privacy and migration/restore behavior. Run `npm test` and
`npm run check` from the repository root. PostgreSQL integration tests require
an isolated database configured with `TAXI_AI_TEST_POSTGRES_URL`; embedded
PostgreSQL compatibility runs do not establish concurrent production capacity.

Before a live pilot, exercise the role-specific screens in a browser, enroll
real staff authenticators, rehearse loss/recovery of credentials, verify the
restricted network entry point and establish a staffed incident-response
procedure. Production deployment and emergency-response integration remain
separate from implementing the console.
