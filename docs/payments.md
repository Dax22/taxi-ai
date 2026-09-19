# Simulated payments, receipts and earnings

This milestone runs a complete **local payment simulation** after a test ride.
No funds are collected, no bank/card details are requested, and driver totals are
not a wallet or withdrawable balance. Paystack is not connected. The simulator
works without provider credentials or Alibaba hosting.

## Try the flow

1. Run `npm run dev` and use separate customer and approved-driver browser sessions
   at `http://localhost:3000/app`. Follow [matching](matching.md) to request and
   claim a sample Wuse II → Maitama ride without GPS or a maps provider.
2. Negotiate a fare, explicitly accept it, confirm the booking, and complete the
   departure → arrival → customer PIN → start → complete flow.
3. Select the completed journey in the customer account. **Trip payment** shows
   the exact booked fare and **Start test payment**. Merely opening the page does
   not create an attempt or mark a payment successful.
4. Start a test payment. It stays **Pending** until you choose **Simulate success**
   or **Simulate failure**. Try failure first: no receipt is issued and no paid
   earnings are counted. **Retry test payment** creates a new reference.
5. Choose success on the new attempt. Both participants can see the saved receipt
   with pickup/destination labels, fare, dates in Abuja time and a `SIM-` reference.
   **Print / save as PDF** opens the browser's print dialog for this receipt.
   The printed page retains the simulation notice.
6. In the driver's **Your earnings preview**, inspect gross completed fares,
   simulated paid fares and fares awaiting successful simulation. Open a trip or
   receipt from its row. **Older trips** and **Newest trips** navigate pages of 20;
   totals always cover all completed trips, including records beyond the page.
7. The administrator's **Payment records** shows amounts, current statuses and
   latest attempt references. Administrators cannot open participant receipts or
   use the customer's simulation controls.
8. Refresh or restart the app: unpaid, pending, failed and paid state persists.
   Pending simulations do not expire or resolve automatically. Return as the
   customer to choose their outcome.

## State and amount rules

| State | Meaning | Customer action in local mode |
| --- | --- | --- |
| `unpaid` | Completed trip; no payment attempt yet | Start test payment |
| `pending` | One open simulated attempt | Simulate success or failure |
| `failed` | Latest attempt failed; earlier attempts remain saved | Start a new attempt |
| `paid` | One successful simulation and one saved receipt | Read or print receipt |

A mere fare agreement, active trip, cancellation or expired request has no
payment record. Completion inserts one record using `ride_trips.fare_kobo` in the
same transaction as trip completion and communication/location cleanup. This is
the accepted booking fare, not the suggestion or any browser-submitted amount.
Payment state has its own version and does not change the ride's fare or version.

All payment records in this release have `mode: "simulation"`; all attempts have
`provider: "simulator"` and server-generated `SIM-` references. Individual amounts
are positive safe integer kobo in NGN. Aggregate amounts are **decimal strings of
kobo** so lifetime totals remain exact beyond JavaScript's safe integer range.
The client formats integer kobo without floating-point division.

This low-volume prototype computes driver totals from that driver's saved records.
Large deployments will need measured query limits and durable aggregate/reconciliation
designs before using the same polling pattern at scale.

Gross fares include every completed trip. Simulated paid totals include each
successfully paid trip once. Outstanding totals include unpaid, pending and
failed trips. No commission, processing fee, tax, refund, split, cash collection,
transfer or payout is calculated. These policies require a separate milestone.

## Module and transactions

`modules/payments/` owns its service/domain/repository/routes and four tables:
`payments`, `payment_attempts`, `payment_receipts`, `payment_commands`.
Rides supplies a narrow participant-checked `paymentContext` port for completion
state, the saved fare and route labels. The `onTripCompleted` callback inserts
the record within the ride transaction without opening a nested transaction or
calling back into rides. Modules do not import each other's implementation.

Start/result commands reload the actor, check ownership, local mode, payment
version and current completed-trip fare. A write commits attempt, payment,
receipt when successful, audit reference and retry key together. Any failure rolls
everything back. Unique constraints permit one payment per trip, one pending
attempt per payment, one receipt per trip and unique attempt references.

An exact duplicate key returns the **current** saved payment without repeating
the command; reusing a key for different fields/actions/trips is rejected. A retry
of an old failed attempt never changes a newer pending or paid attempt. Two
different commands from the same displayed version cannot both succeed. Paid
records have no API for starting another attempt or overwriting their receipt.

The injected simulator is a pure synchronous fixture with no network access.
The service checks its provider/mode/reference/amount/currency/status before
accepting a result, and checks the attempt against the saved trip fare. This is
**not external payment verification**. Only the assigned customer can choose an
outcome, and only in local development. A real integration must not reuse this
customer-controlled outcome endpoint.

## HTTP contract

All endpoints require an account session. Every POST also requires the existing
same-origin, CSRF and `Idempotency-Key` protections. Actor IDs, amounts, currencies,
references, dates and arbitrary statuses cannot be supplied in request bodies.

| Endpoint | Access and body |
| --- | --- |
| `GET /api/payments/rides/:rideId` | Assigned participant; `{ settings, payment }`; payment is null before completion |
| `POST /api/payments/rides/:rideId/start` | Assigned customer, local mode; `{ expectedVersion }` |
| `POST /api/payments/rides/:rideId/attempts/:attemptId/simulate` | Assigned customer, local mode; `{ expectedVersion, outcome: "success" \| "failure" }` |
| `GET /api/payments/rides/:rideId/receipt` | Assigned participant, paid state; `{ receipt }` |
| `GET /api/driver/earnings?before=:rideId` | Driver's own all-time summary and payment page |
| `GET /api/admin/payments?before=:rideId` | Administrator's payment metadata page |

Payment writes return `{ settings, payment, replayed }`. `settings` identifies
simulation and whether local simulation controls are enabled. `payment.attempt`
is the current attempt only; historical attempts remain in storage. Pages return
`payments` and `nextBefore` (null at the end), ordered by completed time then ride
ID descending. Driver cursors must belong to that driver. Historical financial
records remain readable if the driver's approval is later withdrawn.

Participant receipts do not include phone/email, account credentials, pickup PINs,
GPS history or bank/card details. Administrator rows omit participant identities,
route labels and receipt content. The browser uses text nodes for route labels.
Stale account/journey/page responses are discarded; sign-out clears receipt and
earnings views. Receipt data is not written to browser storage.

## Migration, staging and recovery

Migration `007_payments.sql` upgrades schema six to seven and creates **unpaid**
simulation records for previously completed trips. It does not invent successful
payments, backdated receipts or withdrawals. Existing accounts, sessions, fares,
PINs, chat, route quotes and availability records are preserved. Earlier schemas
also upgrade through the existing ordered migrations.

Before starting this release on saved data, use the previous release to create
a backup appropriate to its schema. Older branches cannot open schema-seven
storage. Do not downgrade `user_version` or delete tables in your real data to
switch branches. Use separate databases for comparisons and the documented
[backup/restore workflow](staging.md). Current backups retain payment records,
attempts, receipts and retry history while clearing transient sessions/GPS/calls.

Staging disables **both** start and result simulation endpoints. Its completed
test trips still receive unpaid simulation records, and existing simulation
history remains readable with the same labels. There is no HTTP or environment
flag that converts these records into real payments. A future live integration
needs separate live records/configuration and a plan to exclude all preview data.

## Validation and manual review

Automated checks cover the complete HTTP ride-to-payment flow, integer-kobo
integrity, success/failure/retry/restart, duplicates and competing outcomes,
role/membership/origin/CSRF checks, stale and reused keys, transaction rollback,
receipt isolation, all-time totals and paging, schema-six upgrades, sanitized
backups, disabled staging writes and delayed browser-controller responses.
DOM fixtures check role controls, plain-text receipts and exact amount display.

Real browser layout, accessibility and printing remain a manual review:

- Use separate customer/driver/admin sessions at desktop, tablet and phone widths
  (1440, 768 and 390 pixels). Confirm the amber theme, wrapping and readable totals.
- Navigate all payment controls with the keyboard. Verify visible focus, status
  labels, error announcements and the simulation notice in every financial view.
- Follow failure → retry → success with a fare containing kobo (for example
  ₦4,700.01). Check both participants and the administrator after each step.
- In two customer tabs, start/resolve the same payment and verify only one final
  result and receipt. Disconnect during a command, reconnect and refresh before
  acting again. No retry should count twice in earnings.
- Switch accounts/trips while requests are slow. Previous receipts/totals must
  clear. Check driver pages beyond 20 records and return to newest.
- Print a successful receipt to paper or PDF. Only the selected receipt should
  appear, with the agreed amount, complete reference and simulation notice; cancel
  printing and check the normal dashboard is restored.

## Later provider integration

Paystack test mode is a proposed next adapter, subject to account/credential
setup. This release creates no Paystack account, keys, checkout, webhooks or API
requests. A later adapter should initialize from server-owned amounts and
references, perform network I/O outside synchronous database transactions, verify
provider outcomes, authenticate webhook messages and reconcile retries durably.
Browser redirects must never establish payment success.

Reference the official [test payments](https://paystack.com/docs/payments/test-payments/),
[verification](https://paystack.com/docs/payments/verify-payments/) and
[webhook](https://paystack.com/docs/payments/webhooks/) documentation when building
that adapter. Live acceptance, provider fees, commission, refunds and driver payout
rules are still open decisions. Alibaba hosting remains paused.
