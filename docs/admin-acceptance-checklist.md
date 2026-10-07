# Admin command centre — release acceptance

## Source and rollout boundaries

The admin implementation is developed on `feature/admin-command-center-20261004` in `/home/ubuntu/taxi-ai-admin-20261004`. It extends the reconciled public deployment source plus the ride/call-readiness patch. The source branch is not a deployment record. No production account, permission, payment, order or database is changed by its automated tests.

The production deployment must first be compared with the current runtime, backed up and upgraded through the existing migration procedure. This release requires SQLite schema 50 or PostgreSQL schema 24; do not run an older image against an upgraded database without a tested compatibility/recovery plan. Do not grant broad Docker or administrator permissions merely to make a read-only test pass.

## Operator browser acceptance

Use separate test accounts in separate browser profiles. Only explicitly authorized test records should be used for these checks.

| Screen | Acceptance check |
| --- | --- |
| All transactions | Filter rides, courier jobs and food orders. Verify customer, worker, vendor, date, area, payment-mode/status and vehicle filters. Page through records and confirm the headline totals remain whole-cohort totals. |
| Transaction detail | Compare item quantities, submitted addresses, booking customer, passenger/recipient, worker, vendor, vehicle and recorded timeline against the source transaction. No PIN, password, audio recording or raw signaling may appear. |
| Combined food checkout | Open a kitchen order in a multi-kitchen purchase. Verify all linked child orders, each child's state, and a single sum of allocated child amounts rather than repeated checkout charges. |
| Person profile | Compare activity as buyer/booker, as driver/courier and as vendor separately. Mixed-role activity totals must not be called personal spending, earnings or platform revenue. |
| Business profile | Verify current store/menu availability, linked order history and effective ordering restrictions. Do not reveal a private kitchen's collection coordinates in the directory. |
| Suspension | Record a reason, case reference, public notice, review deadline and scope. Verify a customer cannot create a new booking, a driver cannot go online/claim, and a store cannot accept new ordering availability through either client. |
| Active-job protection | Apply a scoped restriction to an account with an ongoing job. Preserve the existing handover/support flow. Full all-services session revocation must be refused until active work has been safely resolved. |
| Reinstatement | Verify current versions, explicit confirmation, audit history and expiry handling. Reinstatement must not approve missing/expired documents, change paid status or restore stale pending offers. |
| Independent review | An operations staff member who also owns a store cannot lift their own restriction or decide their own appeal. A separately authorized staff member can review it. |
| Account notice | The affected person sees the public reason and appeal result, but not private evidence notes. Another account cannot open that notice. Hide private content on sign-out or page concealment. |
| Location | Require an authorized role and access purpose. Request street tiles only after the explicit map action. Show capture time/accuracy and last-known or unavailable state; no generated history or invented movement. |
| Operational review | Verify queue-specific access, assignment, notes, deadlines, concurrency conflicts and reopening. Resolving a review alone must not move money, reassign a job or declare a parcel returned. |
| Reports/export | Export the selected cohort and compare row counts. More than 10,000 rows must be refused rather than silently truncated. Test spreadsheet-formula escaping and retain payment-mode labels. |
| Platform | Distinguish configured modes and database reachability from real provider connectivity or phone acceptance. Unknown tests remain unknown. |
| Staff permissions | Repeat reads/writes under Owner, Operations, Support, Safety and Finance roles. Finance must not gain individual location/profile exports; Support must not gain location or moderation permission. |
| Accessibility and layout | Review desktop/mobile-width layouts, keyboard navigation, focus after errors, table scrolling and print output. Automated DOM fixtures do not establish this. |

## What is not activated by this release

Provider-backed payment collection/refunds/payouts and automatic reassignment are not implemented by operational review records. Campaigns are planning drafts, not redeemable promotions. Saved reports do not send scheduled emails. The briefing uses deterministic observations, not a generative AI service. Exact fleet-wide tracking, recorded GPS replay, new photo/signature/barcode capture, native admin screens and native appeal screens remain separate work. Browser/phone audio, TURN provisioning, account-email/push delivery and live payment credentials must be configured and verified separately.

## Repeatable automated verification

Run `node scripts/check.mjs` and the full root test suite. The native PostgreSQL suite must use a disposable `taxi_ai_test` database with independent sessions, never the live application URL. The private Unix-socket acceptance path is validated by `scripts/postgres-socket-test-url.mjs`. Tests create unique schemas and remove only their own disposable records. Preserve final logs under `verification/` and record the exact tested commit.
