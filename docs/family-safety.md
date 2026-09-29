# Family Safety

Family Safety lets an adult passenger invite another adult account to view selected trips. An accepted invitation does not start tracking: the passenger must share each confirmed trip separately. Web, iOS and Android use the same account permissions and server rules.

## Using the feature

1. Open **Account → Family Safety**. Confirm that you are an adult, then invite an existing Taxi AI account by its email address.
2. The recipient opens Family Safety, confirms that they are an adult and accepts the invitation. An invitation alone grants no access to trips.
3. After confirming a ride for yourself, select the accepted contact and share that trip. The passenger can see the people with access and stop sharing or remove a contact.
4. The contact opens the shared trip to see its progress and available vehicle location. They can request a check-in; the passenger can respond **I'm okay**, **I need help**, or confirm **I've arrived safely** when the journey is completed.

Sharing is directed: inviting someone to watch your trips does not let you watch theirs. Each direction needs its own invitation and acceptance. The email response does not disclose whether an account exists. Invitations bind to the existing recipient account at creation; registering that email later does not claim an earlier invitation. If necessary, create a new invitation after the recipient registers.

## What contacts can see

| Information or action | Family contact access |
| --- | --- |
| Passenger and assigned driver identity | Limited display information for the selected shared trip |
| Vehicle model and number plate | Shared trip only |
| Trip progress and pickup/destination labels | While the trip is actively shared |
| Vehicle location | Driver-shared GPS, with update time and freshness status |
| Check-in request | Available during the active trip, with a five-minute cooldown across contacts |
| Passenger check-in response | Visible to approved contacts for that shared trip |
| Safe-arrival confirmation | Separate from the driver's completion of the trip |
| Pickup PIN, fare negotiation, private messages and payments | No access |
| Booking, fare acceptance, cancellation or driver trip controls | No authority |

The map is labelled **Vehicle location** because its source is the driver's phone. It is not the passenger's phone location and does not independently confirm the passenger is in that vehicle. Stale, unavailable or interrupted GPS is displayed as uncertainty. A missing update is not automatically classified as an emergency.

Trip completion ends live location access. A limited completion and arrival summary remains available for up to 24 hours. Explicitly stopping sharing or revoking the contact immediately removes the observer's access to that trip and its related inbox details. Saved screens or screenshots on another person's device cannot be remotely erased.

## Notifications and help

Journey events and check-in requests appear in the authenticated family inbox. Optional configured mobile push provides a prompt to open the app; it does not grant trip access. The inbox distinguishes saved, queued, provider-accepted, failed or suppressed notifications, with acknowledgement recorded separately. With Expo, a successful receipt confirms acceptance by APNs or FCM; it does not prove arrival on the phone or that a person saw the message. The delivered state is reserved for providers that can explicitly guarantee device delivery.

**I need help** informs the approved contacts through these configured channels. A passenger can escalate immediately after an **I'm okay** response; the normal response cooldown does not block that escalation. It does not automatically contact the police, an ambulance, a public emergency helpline or an emergency dispatcher. Existing trip SOS controls are separate. No automated crash, scream, route-deviation or unusual-stop classifier is introduced by Family Safety.

## Account and data boundaries

- This release is for consenting adults. Adult confirmation is a self-attestation, not verified age or guardianship. Child or teen accounts, guardian verification and unaccompanied-minor driver eligibility are not enabled.
- Sharing is limited to the account holder's own confirmed rides. A guest booking does not identify or enroll that guest as a family member.
- Family relationships permit viewing only. They do not change the booker's fare agreement, booking confirmation or payment authority.
- Invitations, share grants and commands are stored server-side. Mutations use idempotency keys; version checks protect revocation and check-in changes from stale screens.
- Browser commands require an authenticated session, same-origin checks and CSRF protection. Native commands require an authenticated bearer session. A family ID is not a public capability link.
- Realtime notifications contain account revision signals, not GPS or private trip payloads. A client must request the authorized current view again after a change.

## Deployment and verification

Apply the normal SQLite migrations on development startup. PostgreSQL deployments must run the PostgreSQL migration command before starting updated API instances and workers. Back up the database before upgrading. Existing accounts are not automatically connected or opted into family sharing.

The HTTP regression suite covers consent, browser and native authentication, observer permissions, revocation, trip completion, arrival confirmation, concurrent commands, shared check-in cooldowns and migration preservation. Optional PostgreSQL coverage uses an isolated schema selected through `TAXI_AI_TEST_POSTGRES_URL`.

PostgreSQL compatibility was also exercised through a PGlite/PostGIS wire server with two API pools. That embedded check serializes requests and verifies SQL and permission behavior; it does not establish native PostgreSQL concurrency or production capacity. The native PostgreSQL test retains concurrent retry coverage when run without `TAXI_AI_TEST_POSTGRES_SERIAL_ONLY=1`.

Restoring a development database snapshot closes live grants and completed summaries and suppresses queued or provider-accepted family push jobs. Adult acknowledgements and contact relationships remain, but a passenger must explicitly share a new active trip again. The source database keeps its existing grants.

Before a public release, also verify on physical iOS and Android devices: acceptance on one device and revocation on another, background/foreground resumption, locked-device notification behavior, delayed networks, stale GPS, and the distinction between provider delivery and contact acknowledgement. Browser visual verification and physical-device verification have not been completed in this development environment. Guardian/teen support and passenger-phone tracking require separate product work and eligibility, consent and device testing.
