# Admin expansion: source implementation and acceptance boundaries

This development release extends the reconciled live-source branch and retains the prior ride/calling-readiness patch. It is not a declaration that the Tencent production website has been upgraded. No production migration, account suspension, payment, delivery, or customer-data change is performed by building or testing this branch.

## Implemented workspaces

| Workspace | Function |
| --- | --- |
| All transactions | One creation-date-filtered, keyset-paginated view of passenger rides, courier jobs and individual kitchen orders; filter by customer, worker, store, account participation, area, vehicle and recorded payment mode/status; whole-cohort totals; source amounts separated by payment mode. |
| Transaction summary | Booking customer, passenger/recipient, worker, vendor, submitted route labels, item lines, stage timeline, saved vehicle, fare events and up to 50 call metadata records. Existing parcel handover and exception evidence is projected without PINs or recordings. |
| Combined food checkout | Related kitchen orders and their separate states; per-kitchen amounts counted once rather than repeating the checkout charge. |
| People | Capability-filtered masked-email directory, audited contact detail, driving eligibility, service restrictions and linked cross-service histories. Lifetime activity as customer, driver/courier and vendor is shown separately. |
| Businesses | Store type/town, menu availability, current open/approval state, effective new-order restrictions and linked order history. Private collection coordinates are excluded. |
| Restrictions and appeals | Reasoned warnings and scoped suspensions; expiry, review deadlines, versioned reinstatement, in-account notices, appeals and decisions. |
| Operational reviews | Category-scoped support, safety, finance and operations review records; assignees, due times, statuses, notes and audit. Includes return, refund, reassignment and damaged/missing-item review types. |
| Transaction location | Explicitly requested, purpose-audited latest shared coordinates and optional configured street tiles; stale/unavailable labels; no fabricated historical route. |
| All-service analytics | Counts and exact integer-kobo source amounts grouped by service/payment mode; aggregate-only finance access. |
| Matching evidence | Recorded transaction stage and offer outcomes. Missing evidence is not converted into a claim that no eligible drivers exist. |
| Operations briefing | Deterministic stored-record observations and links, including food-stage inactivity; no autonomous action or external AI claim. |
| Saved reports | Private staff-owned reusable filters with fresh reads and whole-cohort CSV exports capped at 10,000 rows; no silently truncated export. |
| Promotion drafts | Budgeted draft/archive planning records. No discount redemption or budget spending. |
| Platform health | Database-query outcome, allowlisted configuration modes, and explicit unknown provider/device acceptance-test status. No secrets. |
| Sensitive access audit | Location-purpose and export events, alongside existing staff/domain audit. |

## Restriction behavior

Restrictions are application policies, not operating-system permissions. Existing staff roles and MFA remain authoritative. Owners have all moderation scopes. Operations can moderate driver, registered-vehicle work, vendor and store scopes. Safety can moderate those and customer booking scopes. Finance and Support do not gain moderation authority.

A customer restriction blocks new passenger/courier requests and food quotes/orders. Driver or vehicle scope blocks new online availability, matching and claiming. Vendor/store scope removes new ordering availability and blocks reopening/quoting/placing. The currently registered vehicle shares the driver's work restriction; this is not a new multi-vehicle fleet assignment model.

Scoped restrictions preserve already-booked trip progress, existing food fulfilment, support and history. An all-services restriction refuses to revoke sessions while linked active work exists; staff must first arrange a safe resolution. When no active work exists it revokes old browser/native sessions and blocks all new service activity. A fresh login remains possible to inspect notices, receipts, support and appeal; this is not an absolute identity/login ban. Owner accounts cannot be suspended through this workflow. Staff cannot apply, lift or decide appeals for restrictions on themselves or their own stores; an independent authorized reviewer is required.

Application services enforce restrictions for web, native routes and matching workers. Fast matching projects effective restrictions; pending offers and availability are withdrawn transactionally. Approval, document expiry, normal eligibility, existing fare consent and payment checks remain independent. Restoring a capability does not approve documents or change money records. Expired restrictions stop enforcing at their deadline without depending on a scheduled cleanup task.

The account notice page is `/account-notices`. Equivalent authenticated native API endpoints are available under `/api/mobile/v1/account/notices`; a new native screen is not included. Notices do not claim email or push delivery. Private review explanations and case references are not exposed in the account notice API.

## Deliberately not implemented or activated

- Provider-backed live refunds, payouts, commission collection, chargebacks and bank reconciliation. The existing payment integration remains a separate prerequisite; a review record cannot move money.
- Automatic reassignment or a staff override of an agreed fare. An assignment-review item is not a dispatched job. Existing driver acceptance rules remain in force.
- Full GPS-history recording/replay or a global map of every online driver's precise location. The new location view is per active transaction, refreshed on request, and shows the latest available sample only.
- New photo/signature/barcode collection. Existing PIN/handover evidence and parcel exception/return records are shown when actually present.
- Automatic suspension notices by email/push, scheduled report delivery, customer promotion redemption, referral rewards, or spending campaign budgets.
- Generative AI analysis or autonomous sanctions. The briefing is explicitly deterministic and evidence-linked.
- A native admin app or a newly built native notice/appeal screen. The responsive staff website and native enforcement/notice APIs share server policies.
- Buyer–seller production voice calling, TURN provisioning, payment-provider activation, commercial maps capacity, and two-phone live acceptance testing. These remain separate from the admin release.

These are not represented as enabled actions. Pages label unavailable capabilities instead of using fake records or presenting a planning draft as execution. This release does not claim that every item from the broader product roadmap is finished.

## Storage, testing and deployment

SQLite migrations 49–50 and PostgreSQL migrations 23–24 are additive. Run the existing migration path only after a verified backup of the actual production database. Application startup against a fresh test database is not a production migration. Reporting reads never call business mutations. Administrative writes use role checks, current versions and idempotency keys inside the existing transaction boundary. No password hashes, relay secrets, customer PINs or raw call signaling are returned by the new reports.

Before deployment: export and reconcile the current live image/source, preserve runtime-only changes, validate dependencies and the correct database backend, rehearse backup/restore, then apply migrations and deploy the tested source. Do not replace production with a stale checkout. A schema upgrade requires its own recovery plan; switching an old image back is not automatically a database rollback.

The `verification` directory holds actual test logs. Native PostgreSQL acceptance uses a separate private Unix-socket test cluster under the Ubuntu user's home and disposable uniquely named schemas. Production PostgreSQL and SQLite data are not used by tests. Registration fixtures use distinct loopback sources to represent different clients while production rate limits remain unchanged; the shared-link throttle test deliberately reuses one source.

Browser layout, assistive-technology acceptance, actual devices, live staff MFA enrollment, provider webhooks and real transactions must still be checked in the final environment. Automated DOM fixtures do not establish visual or device acceptance. State-sensitive screen visibility changes clear private staff and account-notice data.

## Final review additions

The current review adds customer/worker/vendor participation filters and separate lifetime summaries, expired-offer normalization in matching evidence, and distinct courier-return outcomes. Latest-location freshness is evaluated at the report observation time without mutating the location provider result. Printable summaries expose complete table content instead of preserving a clipped scrolling viewport.

Regression checks include self-review prevention, pending-offer withdrawal, expiry enforcement, cross-client guards, browser page structure, immutable backup/restore of restrictions and appeals, and multi-kitchen paid-test checkout reporting on both SQLite and native PostgreSQL. These fixtures move no live money. Follow [the release acceptance checklist](admin-acceptance-checklist.md) for the required operator/browser checks.

The final dispatch restriction is capability-specific: customer restrictions retain unrelated driver offers, and driver restrictions retain unrelated personal-booking offers. See [the validation record](admin-validation.md) for the exact regression runs and remaining live acceptance requirements.
