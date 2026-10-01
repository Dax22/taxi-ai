# Paystack test checkout

This integration uses Paystack's hosted **test** checkout for rides, courier and
food orders. No live money moves. Live keys and live-mode verification results
are rejected. Existing local payment simulations remain separate.

## Setup in VS Code

1. Create or open your Paystack account and select test mode in its dashboard.
2. Open the project's untracked `.env` file. Copy `.env.example` if necessary,
   preserving existing configuration. Add the **test secret key** from Paystack:

   ```dotenv
   TAXI_AI_PAYMENT_PROVIDER=paystack_test
   PAYSTACK_SECRET_KEY=sk_test_REPLACE_WITH_YOUR_TEST_SECRET
   PORT=3003
   ```

   Never commit this file, paste the secret into chat, or put it in browser or
   `EXPO_PUBLIC_` configuration. The server uses hosted checkout, so a browser
   public key is not required.
3. In the integrated terminal run `npm run config:check`, then restart with
   `npm run dev`. Open `http://localhost:3003/app` or `/eats`.
4. For hosted testing, set the same server-only variables on every API and worker
   process. PostgreSQL deployments must run `npm run db:postgres:migrate` before
   starting the new version. SQLite upgrades automatically at startup; take an
   operator backup before migration.
5. Set the **test webhook URL** in Paystack to
   `https://YOUR_APP_DOMAIN/api/webhooks/paystack`. The backend sets its own fixed
   return URL to `https://YOUR_APP_DOMAIN/payment-return` using the configured
   application origin. Existing staging gateway forwarding is sufficient.

Paystack cannot call a localhost webhook. Locally, use **Check payment** and the
background reconciliation worker. Do not expose the development server as a
production payment endpoint. Use a private HTTPS staging deployment to validate
real provider notifications. Only the exact configured POST webhook skips the
staging tester login; signature authentication and the HTTPS gateway remain.

## Test the customer journeys

- **Ride / courier:** create a new request after enabling test checkout, negotiate
  and explicitly accept the fare, then confirm the booking. Open its payment
  panel and start Paystack test checkout. Use Paystack's official test payment
  instructions. Return and choose **Check payment**. The driver can start only
  after server-verified payment, and still needs the existing pickup PIN and GPS.
- **Food:** place a single-kitchen order or combined checkout. Portions are
  reserved for 15 minutes, and every kitchen in a combined checkout shares one
  payment. Complete checkout from any group order. Kitchens cannot accept or
  prepare until payment is verified. Confirm that cancelling an unpaid group
  releases all its reserved portions once.
- **Web / mobile:** hosted checkout opens outside the app. Returning is not
  proof of payment. Use the explicit payment refresh control. Changing account
  or booking clears the old checkout link and ignores delayed responses.
- **Failure tests:** decline a test payment, close checkout before finishing,
  refresh/retry the same command, restart the server, send duplicate provider
  notifications, and cancel or let a food reservation expire before confirmation.
  A late success must show refund review and must not restart cancelled work.

Use Paystack's current documented test instruments rather than a real card:
https://paystack.com/docs/payments/test-payments/

## Amounts, reconciliation and recovery

The server owns NGN integer-kobo totals. Riders pay the immutable confirmed fare;
food uses immutable order totals summed across the checkout. Client-supplied
amounts and arbitrary return URLs are not accepted. Payment notifications are
HMAC-SHA512 authenticated using the original request bytes. The server also
verifies reference, amount, currency and `domain=test` with Paystack before
fulfillment. A redirect or a client success message cannot mark an order paid.

One durable reference is reserved before initialization. Concurrent commands and
exact retries reuse it. An uncertain initialization is never blindly repeated
with a new reference. A provider timeout can therefore leave a payment in
`unknown` without a recoverable checkout link. Keep checking the existing
reference; this milestone does not automatically create a replacement charge.
Definitively failed/abandoned references are also retained for late-event checks.

Workers claim bounded batches and retry verification with backoff, starting at
30 seconds and capped at one hour. Provider network calls never hold a database
transaction. Verified payment, receipt, audit record and food fulfillment commit
together. No driver/vendor payout occurs. Refund review records do not mean
that a refund has been issued.

To pause **new** Paystack bookings, set `TAXI_AI_PAYMENT_PROVIDER=off` while
retaining `PAYSTACK_SECRET_KEY`. Existing references can still reconcile. Existing
Paystack bookings keep their payment requirements; older simulator bookings keep
their original flow. Removing the test key also stops provider verification.

If a paid kitchen order is cancelled, its own refundable amount is recorded once
for manual review; unaffected paid siblings may continue. If an unpaid group is
cancelled, expires, or loses an available kitchen before settlement, the group
closes and any late successful payment requires refund review.

## Scope before live launch

Implemented: test collection, signed webhook, durable reconciliation, exact
receipts, duplicate protection, account ownership, ride start and food fulfillment
gates, reservation expiry, and recorded full/partial refund-review amounts.

Not implemented: live collections, automatic refunds, driver/vendor bank payouts,
commission/processor-fee ledger, seller subaccounts, settlement reconciliation,
saved-card consent/charging, disputes/chargebacks or live finance reporting. The
existing earnings/admin finance screens still report only simulator history;
Paystack test receipts appear on the customer payment panel. Do not describe
those simulator totals as Paystack earnings or withdrawable balances.

Complete these capabilities and Paystack business/settlement onboarding before
launching real-money payments. Nigeria cannot use the currently documented
South Africa-only card-preauthorization flow to mimic Uber's hold/capture model.
This milestone is an upfront-charge design after fare agreement.

## Official integration references

- https://paystack.com/docs/payments/accept-payments/
- https://paystack.com/docs/payments/verify-payments/
- https://paystack.com/docs/payments/webhooks/
- https://paystack.com/docs/payments/card-preauthorization/

## Verification

Focused tests cover provider/configuration bounds, webhook/gateway isolation,
immutable retries, unknown results, wrong amount/currency/domain, cancellation,
food-group settlement, inventory expiry, account-switch privacy and web/native
checkout controls. PostgreSQL tests exercise concurrent starts/settlement against
a real disposable database in CI. The full repository suite checks compatibility
with existing booking, food, courier, tracking and simulator operations.

Successful tests with injected providers do not establish that your Paystack
account, network, deployment or two physical phones have been validated. Finish
those checks using your own test credentials before any live-payment milestone.
