# Ride journey — development preview

The account dashboard supports a complete **test** trip after fare agreement.
Progress is entered by the participants. It does not dispatch a real vehicle,
track GPS, verify physical arrival or collect payment.

## Booking and transitions

| Current state | Action | Who | Result |
| --- | --- | --- | --- |
| Agreed fare | Confirm booking | Customer | Booked; copy the immutable fare and generate a pickup PIN |
| Booked | On my way | Assigned approved driver | On the way |
| On the way | I have arrived | Assigned approved driver | Arrived |
| Arrived | Verify PIN and start | Assigned approved driver | In progress, only with the correct PIN |
| In progress | Complete trip | Assigned approved driver | Completed; preserve fare and timestamps |
| Requested through arrived | Cancel | Customer or assigned approved driver | Cancelled; record actor, time and reason |

Each action requires the displayed ride version. The server rejects skipped,
repeated, stale or unauthorized transitions. A successful retry with the original
idempotency key returns the current saved ride without repeating the action.

An agreed fare does **not** reserve availability until the customer confirms.
Confirmation checks both participants again. An existing open request or booked
trip blocks the customer; an existing negotiation or booked trip blocks the
driver. Claims and new requests also check active trips. These checks run inside
the same `BEGIN IMMEDIATE` transaction as confirmation. Partial unique indexes
provide an additional guard against overlapping active trip records.

This preserves the previous milestone's unbooked agreements, including multiple
old agreements for the same account. No old agreement is automatically converted
into a trip. If another negotiation is in progress, confirmation waits until it
is resolved or cancelled. Agreed quotes do not yet have a booking deadline.

## Pickup verification

- The server generates a uniformly random six-digit string, preserving leading
  zeroes. Only the customer's authenticated ride responses include the PIN.
- The assigned driver enters the PIN at pickup. Driver responses, history after
  the trip ends, available-request lists and administrator routes do not disclose
  it. The PIN is not sent through chat automatically or included in audit events.
- Five incorrect, well-formed attempts pause verification for five minutes. The
  failure counter and lock survive restart. At the exact deadline, attempts are
  allowed again. Successful verification clears the PIN and its failure state.
- Incorrect attempts and their retry keys commit together before the API returns
  `INVALID_PICKUP_PIN`. Retrying the same failed command does not count twice.
  Submitting a changed PIN needs a fresh key. Reusing a key with different input
  returns `KEY_REUSED`. Malformed input does not count as a guess.
- Starting or cancelling a trip clears the live PIN column in the same transaction
  as the state change. PIN fields also clear on account/ride changes and logout.

For this local preview the PIN is **plaintext in the private SQLite database** so
the customer can retrieve it after refresh or restart. There is no encryption at
rest. Clearing the live column is not forensic erasure of SQLite WAL/backups.
PINs are not identity checks, location checks, payment authorization, or a
replacement for production safety operations. A real pilot needs reviewed secret
storage, retention and verification policies alongside the existing hosting work.

## Cancellation and history

The web cancellation form asks for confirmation and one reason: plans changed,
pickup problem or other. Older API clients may omit `reason`, recorded as `other`.
Cancelling preserves an already agreed fare; it does not rewrite or reopen the
fare negotiation. Cancelling an open negotiation also closes that negotiation.
No cancellation fee, refund or payment is created.

Ordinary cancellation is unavailable once a trip starts. Early termination,
emergency assistance and disputes are separate, unimplemented workflows. The
driver can complete an in-progress test trip. Completion records the agreed fare
and server timestamps, not a receipt or proof of payment.

Chat stays writable through booking, arrival and the trip. Completion or
cancellation makes it read-only; participants can still read and report messages.

The Trip history section contains only the account's completed/cancelled journeys.
It loads 20 at a time, newest first, with an older-trip cursor. Cursor ordering
uses completion/cancellation time and ride ID to handle matching timestamps.
Historical trips are selectable even when outside the recent-request list.
Use Refresh history to reload the newest page. The existing request endpoint
keeps its 50-record bound, with active requests/trips first. Legacy cancellations
remain visible but have no invented actor/reason activity records.

## API contract

All writes require an authenticated participant, same-origin JSON, CSRF token,
an `Idempotency-Key`, and a numeric `expectedVersion`. Actor IDs, timestamps,
driver assignment, prices, state names and generated PINs are server controlled.

| Route | Body or response |
| --- | --- |
| `POST /api/rides/:id/confirm` | `{ expectedVersion }` |
| `POST /api/rides/:id/depart` | `{ expectedVersion }` |
| `POST /api/rides/:id/arrive` | `{ expectedVersion }` |
| `POST /api/rides/:id/start` | `{ expectedVersion, pickupPin }`; PIN must be a six-digit string |
| `POST /api/rides/:id/complete` | `{ expectedVersion }` |
| `POST /api/rides/:id/cancel` | `{ expectedVersion, reason? }` |
| `GET /api/rides/history?before=:id` | `{ rides, nextBefore }`; omit `before` for the newest page |

Ride responses add `trip` and `activity`. Public `status` describes the trip when
one exists; `negotiation.status` still describes only the immutable fare agreement.
The rides repository owns `ride_trips` and `ride_activity` as well as the original
ride/fare tables. Chat reads the lifecycle through the existing injected ride port.
The browser uses shared lifecycle vocabulary and a dedicated trip view, never SQL
or API service imports.

Schema migration `003_trip_lifecycle.sql` upgrades versions 1/2 to 3 without
rewriting existing accounts, sessions, fare events, chat messages or reports.
Earlier code refuses the newer database. Use a separate test database when
comparing branches; do not reset or manually downgrade an existing account file.

## Validation and manual review

Automated tests exercise separate authenticated accounts, the full lifecycle,
PIN disclosure and lock boundaries, race conditions, duplicate commands,
transaction rollback, restart persistence, history pagination and v1/v2 upgrades.
Small DOM tests check PIN clearing, captured versions, confirmation and cooldown
controls; they do not verify browser layout or accessibility.

Browser review is pending because the available cloud browser blocks local
previews. In the local VS Code application:

1. Use customer and approved-driver sessions to negotiate and explicitly accept
   a fare. Confirm as the customer and check the displayed driver/fare/PIN.
2. Verify that only the customer sees the PIN. As the driver, choose On my way,
   I have arrived, enter the PIN, and start. Refresh both sessions at each stage.
3. Try an incorrect PIN. For a separate test trip, submit five wrong PINs and
   verify the cooldown survives refresh. Do not use real passengers or travel.
4. Complete the test trip. Check the saved price, activity timestamps, trip
   history and read-only chat. Both participants should be free for a new request.
5. Create another test trip. Open Cancel, choose a reason, then Keep journey;
   verify nothing changed. Confirm cancellation and check actor/reason history.
6. Check keyboard operation and 390px, 768px and 1440px layouts. Switch accounts,
   select older trips, sign out and confirm no pickup PIN remains displayed.

See [the voice guide](voice.md) for the local audio-call preview. GPS, payments,
verified onboarding and safety operations remain planned. Eats, motorcycle courier
and autonomous services keep their planned labels.
