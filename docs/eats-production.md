# Taxi Ai Eats production launch gate

**Status: blocked.** The current app uses fictional kitchens, `test / not_charged`
orders and a manually claimed test delivery queue. Do not onboard real buyers or
sellers, collect money, or promise dispatch from this build. The existing hosted
mode is invited staging, not a public production environment.

## Release requirements

| Gate | Acceptance evidence | Current state |
| --- | --- | --- |
| Money | Server-created NGN payment intent for the exact saved checkout; signed webhook and independent verification of reference, amount and currency; durable idempotency/reconciliation; full and partial refunds; seller/courier settlement ledger and payout reconciliation; failed, late and duplicate payment tests | Not implemented for Eats |
| Sellers | Verified business/identity and appropriate food safety evidence for each seller type and locality; expiration/re-review controls; staff audit trail; a private home-kitchen pickup point and town-only public profile | Manual test review only |
| Fulfillment | Real courier availability and assignment, stale GPS handling, accepted-job timeout/recovery, customer ETA/location sharing with consent, push notifications and exception support staffed during service hours | Test queue and timeline polling only; staff can now return an uncollected job to the queue or cancel a failed delivery with a reason |
| Customer policy | Published fee/tax calculation, cancellation and refund policy, allergy notice, support contact and response targets | Not established |
| Data and operations | Private production deployment, access control, backups and restore drill, monitoring/alerts, bounded retention and erasure, incident procedure and data protection review | Staging controls exist; production acceptance outstanding |
| Acceptance | Hosted staging end-to-end on separate Android and iOS phones plus desktop/browser widths, poor network and offline retry, concurrent inventory/claims, accessibility, staff recovery and a rollback drill | Automated tests only |

The payment design must hold an order from kitchen and courier fulfillment until
the provider confirms the exact charge. A redirect or client success callback
alone cannot mark it paid. A charge arriving after stock or quote validity is
lost needs an automated refund/reconciliation path. Multi-kitchen orders need
one consistent payment-to-orders transition and a documented split, settlement
and refund policy. Provider credentials and webhook endpoints belong in secret
storage, never the web or native bundle. Paystack's official
[acceptance](https://paystack.com/docs/payments/accept-payments/),
[verification](https://paystack.com/docs/payments/verify-payments/),
[webhook](https://paystack.com/docs/payments/webhooks/),
[refund](https://paystack.com/docs/payments/refunds/) and
[multi-split](https://paystack.com/docs/payments/multi-split-payments/) guides are
one possible Nigerian provider reference; a provider and commercial settlement
model have not been selected for this repository.

Kitchen eligibility needs a business review of the requirements that apply to
restaurant, vendor and home cooking in each launch locality. The current
free-text review reference is not proof of a licence or inspection. See
[NAFDAC's micro-scale guidance](https://nafdac.gov.ng/our-services/micro-small-medium-enterprises-msme1/)
and the [Nigeria Data Protection Commission](https://ndpc.gov.ng/) when planning
food safety and personal data reviews; obtain jurisdiction-specific advice
before approving real sellers.

## Isolation and rollout

Keep ride negotiation, parcel booking, availability and their payment simulation
contracts unchanged. Introduce live Eats payment and seller evidence in Eats-owned
tables and ports, with an explicit default-off activation gate. Back up the
database before migrations and test both SQLite and PostgreSQL migration paths.
Use a dedicated private staging environment and provider test keys first. Run
the full repository and native checks, then two-phone journeys and failure drills.
Publish a production host only after every gate above has named evidence and an
operator responsible for support, refunds and incident response.

Staff recovery in the present preview is deliberately limited. On the Eats
**Kitchen review** screen, staff can open a full order ID. For a courier who has
not collected food, **Return to courier queue** revokes that courier's access,
rotates the pickup code and reopens the job; it does not guarantee a replacement
courier. After collection, **Cancel order** records a reason and releases the
courier without restocking prepared food. Neither action moves money or sends a
real support notification. The reason appears in the order timeline, so staff
must keep private incident details in their separate support record.

An operator can set `TAXI_AI_EATS_PAUSED=true` and restart the API to stop new
food quotes and placements while leaving existing food orders, ride bookings and
parcel work available. This is an emergency pause, not a live-payment launch
switch. Recheck outstanding food orders and quotes before resuming.
