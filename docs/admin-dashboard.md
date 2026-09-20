# Separate staff dashboard and operational monitoring

Status: architecture and delivery plan accepted for future implementation. No new
staff dashboard, analytics warehouse, staff MFA or automatic risk detector ships
with the mobile foundation. `apps/admin/` reserves the boundary. Existing web
administrator reviews continue to work while the separate application is built.

## What Uber publishes, and what that means for Taxi Ai

Uber's [rider privacy notice](https://www.uber.com/global/en/privacy-notice-riders-order-recipients/)
describes account, trip/order, permitted location, device and usage data. It
describes operational troubleshooting, support investigations and fraud detection,
including comparisons of current and historical activity for suspicious patterns.
These are published practices, not a claim about Uber's private dashboard design
or source code. Reviewed 20 September 2026.

Uber's [RideCheck explanation](https://www.uber.com/us/en/newsroom/ridecheck/)
describes trip GPS and phone sensors detecting possible crashes, unusual stops
and trips going off course, followed by check-ins and support options. This
historical US announcement does not establish availability or emergency-service
integration in Abuja.

Taxi Ai can implement comparable categories of oversight in stages. The proposal
below is our design, not a representation of Uber's internal system. No device
monitoring SDK, advertising tracking or continuous customer GPS collection is
added by the current milestone.

## Staff workspaces

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

## Architecture and access

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

1. Staff identity/MFA, permissions and audited read APIs; separate dashboard shell.
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
