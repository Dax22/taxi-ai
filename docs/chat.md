# Private ride chat — development preview

Chat is implemented for the existing local customer/driver experience at `/app`.
It is not a public messaging service. Only the customer and assigned driver can
read or send in a ride conversation. Other customers, unassigned drivers and
administrators cannot open that conversation through the chat API.

## Behaviour

| Ride state | Conversation behaviour |
| --- | --- |
| Requested, no driver | Waiting message; chat has not opened |
| Negotiating | Both participants can send messages and structured fare offers |
| Fare agreed | Messaging continues; the agreed fare cannot change |
| Booked, on the way, arrived or in progress | Messaging continues; fare changes remain unavailable |
| Completed or cancelled after assignment | Saved conversation remains readable/reportable; new messages are rejected |

Messages are plain text, limited to 2,000 JavaScript string units and 500 messages
per ride in this preview. There are no attachments, edits or deletions. The API
pages history in batches of 100 using a per-ride sequence. The client loads those
pages, then polls for new messages every three seconds while the page is visible.

Unread counts include only incoming text messages after the person's saved read
cursor. Reading the end of a visible conversation advances that cursor. Older or
repeated read acknowledgements cannot move it backwards, and clients cannot mark
future messages read. Fare changes remain visible in the ride and offer cards;
unread badges do not count fare events. Push notifications and typing indicators
are not implemented.

Draft messages stay in browser memory per selected ride. A successful send clears
only the submitted draft. Network failures retain the draft and request key for
retry; an intentional new send gets a new key, even for identical text. Signing
out clears drafts, and reloading the page loses unsent drafts. Saved messages stay
in the database. Responses from a previous ride or account are discarded.

## Fare consent

The conversation displays offers and the agreement from the existing ride model.
The structured fare form and **Accept ₦…** buttons use the existing ride endpoints.
The client submits the displayed offer ID and ride version; the server checks
the opposite participant, current offer, expiry and immutable agreement rules.

Free text such as “okay,” “I accept,” or “₦4,700” never changes a fare or creates
an offer. Chat has no separate price authority and no AI parsing or auto-acceptance.
Offers are still recorded as `in_app` commands; presenting them beside messages
does not change the domain event format.

## Reporting and privacy

A participant can report the other person's message for harassment, an unsafe
request, spam or another concern. Reports are unique per message/reporter; retries
return the original report. The administrator dashboard exposes that reported
message, reason and participant names, without granting conversation access or
showing unreported messages. Marking a report reviewed records the administrator
and time. It does not block an account or resolve a safety incident.

This is a local review queue, without notifications to outside responders or a
staffed emergency service. Blocking, suspension, appeals and retention/deletion
are future operations work. Account profiles do not expose phone numbers or email
addresses to peers. People can still voluntarily type personal information in a
message, so the interface advises against sharing sensitive details.

“Private” describes application access control. Messages are stored as plaintext
in the local SQLite file; this is not end-to-end encryption. A person with direct
database access can read them. The current server uses loopback HTTP. Production
transport, storage protection, audited support access, retention and operational
moderation require separate design before a real pilot.

## API contract

All routes use the existing session protections. Writes require same-origin JSON,
CSRF and the shared authenticated write limit (60 writes per user per minute).
Message sends additionally require an `Idempotency-Key`; read markers and report
creation/review have their own naturally idempotent semantics.

| Route | Result / input |
| --- | --- |
| `GET /api/chat` | Unread counts and last sequence for the user's latest 50 rides with assigned drivers |
| `GET /api/rides/:id/chat?after=0` | `{ rideId, messages, nextAfter, hasMore, lastSequence, readThrough, unread, canSend, reportedMessageIds }` |
| `POST /api/rides/:id/chat/messages` | `{ body }`; returns saved `message` and `replayed`; 201 new / 200 retry |
| `POST /api/rides/:id/chat/read` | `{ throughSequence }`; returns the monotonic `readThrough` and remaining `unread` |
| `POST /api/rides/:id/chat/messages/:messageId/report` | `{ reason }`; returns `report` and `replayed`; 201 new / 200 retry |
| `GET /api/admin/chat-reports` | Up to 100 reports, open first, with only their reported message |
| `POST /api/admin/chat-reports/:id/review` | `{}`; returns the saved report; administrator only |

Message fields are `id`, `rideId`, `sequence`, `senderId`, `body` and `createdAt`.
Actor IDs, times and sequence numbers come from the server. Unexpected input
fields, invalid cursors and unsupported report reasons are rejected. Unrelated
and unknown ride/message IDs return 404 after authorization checks. An owner's
unassigned ride returns `CHAT_NOT_READY`; new sends to completed/cancelled/full threads
return `CHAT_CLOSED`/`MESSAGE_LIMIT`.

## Module and migration

`services/api/src/modules/chat/` contains its domain validation, repository,
service and routes. The composition root injects account and ride service ports;
chat never imports their repositories or reads their tables directly. Messages,
read cursors, command keys and reports belong to the chat repository. Sending
commits the message, audit reference and command key in one SQLite transaction.
Audit entries do not duplicate message bodies.

Migration `002_chat.sql` adds schema version 2 while preserving existing accounts,
sessions, rides and fare events. Startup applies it automatically. No reset or new
administrator is needed for an existing account database. Earlier code that only
supports schema version 1 will reject the upgraded database. Use a separate test
database when comparing old branches; never delete your data to make a downgrade
start. A tested upgrade fixture verifies version-one account/session/ride data.

## Manual review

Automated tests cover permissions, retry/rollback behaviour, pagination, unread
markers, reports, migration, persistence, client state isolation and fare cards.
They do not establish browser layout or complete interaction correctness. Local
browser previews are blocked in the available review environment.

On your development machine, follow the root account/admin setup if needed, then:

1. Open `/app` as a customer and in a separate browser/profile as an approved
   driver. Request and claim a test ride. Confirm only those two accounts can
   open its conversation.
2. Send messages both ways. Scroll away from the bottom, receive another message,
   and check the unread badge. Scroll to the latest message and verify it clears.
   Check that a hidden browser tab does not mark new messages read.
3. Type “I accept ₦4,700” as a message. Confirm no fare agreement is created.
   Offer ₦5,000 using the fare form, counter with ₦4,700 and explicitly accept.
   Verify replaced/own/expired offers have disabled acceptance buttons.
4. Start typing a message, switch to a different saved ride, and return. Confirm
   the draft belongs to its original conversation. Check that sign-out clears it.
5. Interrupt the connection while sending; retry the same message. Confirm the
   draft survives and only one copy is saved. Refresh and restart the server to
   verify saved history remains. Cancel another ride and check its chat is read-only.
6. Report a peer message. Confirm it appears once in the administrator's queue,
   unrelated messages are absent, and **Mark reviewed** persists after refresh.
7. At phone, tablet and desktop widths, check wrapping, keyboard access, visible
   focus, readable offer cards and composer/report forms. Check status/error
   announcements with a screen reader; the transcript itself is keyboard-readable.

Audio calling is implemented separately; see [the voice guide](voice.md).
Chat never opens the microphone. Neither chat nor calls record or transcribe audio.
