# Separate staff dashboard and operational monitoring

Status: the first read-only operations dashboard ships in **0.18.0**, under
`apps/admin/`, with direct pages at `/admin`, `/admin/accounts`, `/admin/trips` and
`/admin/analytics`. Account and trip links open their own detail pages. It uses
the same saved application data and existing administrator role; no metrics are
seeded or invented. [Setup and page guide](../apps/admin/README.md).

## Implemented reporting

Account search accepts name, email, account ID or saved profile plate. Driver
accounts include both legacy drivers and customers who added a driver capability.
Directory totals exclude staff and separate customer-only accounts from driver
accounts so one person is counted once. Opening an account shows its email,
creation time, application status, vehicle, lifetime passenger spending, lifetime
driving fares and every saved journey through stable next/previous pages.

Trips expose route names, participants, current status, agreed fare, payment state,
the saved vehicle snapshot and recorded operational events. There is no raw GPS,
pickup PIN, private conversation, licence number or document content in this read
model. Private evidence and existing support/SOS actions remain in the original
review workspace, linked from the sidebar.

| Metric | Definition |
| --- | --- |
| Request cohort | Requests created within the chosen inclusive Nigeria (WAT) dates; default 30 days, maximum 366; statuses are current at refresh |
| Account totals | All current non-admin accounts; new accounts are counted within the selected period |
| Completed trip cost / driving fares | Sum of agreed fares for completed trips only; passenger and driver participation are shown separately |
| Paid · simulated | One current paid simulation per completed journey; failed/retried attempts do not multiply the total |
| Outstanding · simulated | Completed fares whose current payment status is unpaid, pending or failed |
| Completion / cancellation rate | Current completed / cancelled requests divided by every request in the cohort; expiration is separate; empty denominators display a dash |
| Average completed fare | Completed fares divided by completed trip count, rounded down to one kobo |
| Daily chart / routes | Same request cohort; zero-filled WAT days, exact value tables and eight most-requested routes |
| Profile totals | Lifetime participation totals; filtering its trip table does not change these totals |

All amounts are NGN. Individual fares remain integer kobo; totals use BigInt and
decimal strings through JSON so large totals retain precision. The repository
reads reporting facts in batches, without retaining the complete history in
memory. Pages use stable `(created_at,id)` keyset pagination, including timestamp
ties. No commission, payout, refund, rating or forecasting figures are inferred.

The backend exposes `/api/admin/console/{session,accounts,trips,analytics}` and
detail routes `/accounts/:id`, `/trips/:id`. `/login` requires existing staff
credentials and cannot promote users. Every reporting read checks the administrator
role on the server; native bearer tokens cannot authorize these cookie routes.
Detailed account and trip reads append `admin.account_viewed` / `admin.trip_viewed`
audit events with staff, subject and timestamp. Email is masked in the directory.
Sensitive data is not embedded in HTML or cached. The controller checks the staff
session before and after data loads and discards old reads on account change,
sign-out or backgrounding. Dashboard filters use bound SQL parameters.

Schema 13 adds account/trip reporting indexes only. Back up existing data with
the previous release before upgrading; no identities, approvals, sessions or
historical records are rewritten. Current backup/restore requires schema 16.

Automated checks cover role/session isolation, audited reads, exact money,
retried payments, dual-role totals, over a thousand historical records, cursor
ties/reverse pages, date boundaries, literal search, empty states, text rendering,
late responses, direct assets/routes and preservation of schema-12 records.
Browser layout, keyboard, screen-reader and device acceptance are still pending.

Dedicated staff origin/session audience, MFA, granular staff roles and an analytics
warehouse are future work. This preview is a separate application on the same
origin and existing web session; it is not a replacement for the production access
and operational controls below. No new hosting or public rollout is included.

## What Uber publishes, and what that means for Taxi Ai

Uber's [rider privacy notice](https://www.uber.com/global/en/privacy-notice-riders-order-recipients/)
describes account, trip/order, permitted location, device and usage data. It
describes operational troubleshooting, support investigations and fraud detection,
including comparisons of current and historical activity for suspicious patterns.
These are published practices, not a claim about Uber's private dashboard design
or source code. Reviewed 20 September 2026.

Uber's [public business dashboard description](https://www.uber.com/us/en/business/)
also describes trip/activity views and usage, cost, time and location reports.
This is a public business product reference, not visibility into Uber's internal
staff tooling. Taxi Ai's page design and reporting definitions are its own.

Uber's [RideCheck explanation](https://www.uber.com/us/en/newsroom/ridecheck/)
describes trip GPS and phone sensors detecting possible crashes, unusual stops
and trips going off course, followed by check-ins and support options. This
historical US announcement does not establish availability or emergency-service
integration in Nigeria.

Taxi Ai can implement comparable categories of oversight in stages. The proposal
below is our design, not a representation of Uber's internal system. No device
monitoring SDK, advertising tracking or continuous customer GPS collection is
added by the current milestone.

## Further staff workspace scope

| Workspace | First useful view | Important limit |
| --- | --- | --- |
| Overview | Active test trips, matching wait, cancellations, API errors, payment failures, oldest open case | Define time window and denominator; distinguish simulation from real activity |
| People & approvals | Search by account/trip reference; customer, driver, future courier/vendor status; document-review queue | Mask contact details by default; opening identity evidence requires review permission and an audit record |
| Trip operations | Assigned participants, agreed fare, current trip state, relevant timestamped shared location | Show accuracy and age; label missing/stale positions; no claim that an old point is live |
| Support | Case queue, user reports, trip timeline, recorded resolution and appeal | Scoped to a case; reported messages rather than unrestricted browsing of private conversations |
| Safety | SOS case, reporting participant, trip/driver/plate, last available location and contact delivery results | Restricted safety role; human-led escalation and staffing; simulation must remain explicit |
| Finance | Payment/receipt reference, reconciliation, refund workflow, driver/vendor settlement | No card secrets; reasons and approvals for financial actions; separate from support access |
| Service health | Request errors/latency, queue age, provider failures, restart/backup status | Diagnostic fields only; no raw passwords, credentials, GPS, documents or chat in logs |
| Staff & audit | Staff roles, revoked sessions, sensitive access and actions, review/export history | MFA, least privilege and explicit staff administration |

Vendors, food orders, parcels and settlements enter these views only when their
business modules exist. Do not create synthetic “live users” or generic counters
that combine customers, drivers, vendors, trips and orders without definitions.

## Production architecture and access still planned

- A separate `apps/admin` frontend and staff origin, eventually an admin subdomain
  of the owned Taxi Ai domain. The same modular backend remains the source of truth.
- Dedicated staff authentication/session audience, MFA, bounded session lifetimes
  and revocation. Customer native bearer tokens are rejected. A hidden URL or a
  user-selected role is not authorization.
- Backend permissions for support, operations, safety, finance and staff access
  management. Apply record/scope restrictions as well as page-level permissions.
- Case/reference/reason required for sensitive reads and consequential actions;
  record staff identity, action, subject, timestamp and result. Audit both reads
  and writes, restrict exports and protect audit retention from casual changes.
- Read models expose minimal fields. Cursor pagination, bounded filters, explicit
  last-updated times, stale-data states and refresh/reconnect handling come first.
  Start with bounded polling; add streaming only with authentication, reconnect
  and ordering tests. Never trust optimistic status after a failed mutation.
- Version checks and idempotency keys protect reviews and financial commands.
  Bulk exports, account restrictions and refunds need explicit permission and
  reviewable reasons. Account restrictions must include notice/appeal workflows.
- Document purposes, consent/permissions, retention/deletion, access requests and
  provider sharing before public operation. Set real retention periods after the
  operational and privacy requirements are settled; do not retain raw GPS forever.

## Monitoring boundaries

Customers choose location permission. Driver/courier tracking must have a clear
Online or active-job purpose, visible status and a reliable stop condition.
Precise locations are not a general staff browsing feature. No arbitrary remote
microphone/camera activation or silent listening to calls is planned. The current
native foundation does not collect location or motion sensor data at all.

Crash/off-route models produce uncertain signals. Evaluate false alarms across
devices, rough roads, traffic stops and weak GPS before enabling them. Ask whether
help is needed and route unresolved cases to trained staff. Keep manual SOS usable
independently of the model. Real police/emergency or trusted-contact delivery needs
an agreed, tested channel, verified recipients, retries/delivery status and staffed
fallback; creating an incident is not proof that emergency help was contacted.

AI agents may summarize a case, prioritize a queue or suggest a risk review using
approved data. They must not autonomously accept fares, charge/refund users, ban
accounts, disclose identity evidence or promise police response. Keep reasons,
human review, appeal paths and a manual fallback. Do not label whole neighborhoods
“dangerous” from unverified reports or demographic proxies.

## Delivery order

1. Extend the implemented dashboard and audited read APIs with dedicated staff
   identity/MFA, scoped permissions and a separate origin before a live pilot.
2. People/approval review, trip operations and case handling using current modules.
3. Payment reconciliation and staffed safety workflows with real provider tests.
4. Courier and Eats queues as their end-to-end services become available.
5. Evaluated anomaly detection and agent-assisted triage, with measured false
   positives, response times, access reviews and reliable manual controls.

This proceeds alongside native ride workflows and is a requirement before a live
passenger pilot. Alibaba hosting setup is still paused. No deployment is implied.

Acceptance: public users cannot access staff endpoints; staff cannot exceed their
permission or case scope; sensitive reads and mutations are audited; concurrent
reviews cannot overwrite one another; stale GPS is obvious; provider outages and
failed notifications never appear successful; logout/revocation cancels access;
simulations cannot be mistaken for real service activity.
