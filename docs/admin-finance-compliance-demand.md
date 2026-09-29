# Finance, driver compliance and demand analytics

These workspaces extend the existing admin application at `/admin`. They use
saved application records and the same staff session, permission and authenticator
checks as the other staff pages. They do not require a Paystack account.

| Page | Staff access | Purpose |
| --- | --- | --- |
| `/admin/finance` | Owner, Finance | Simulated payment totals and paginated ledger |
| `/admin/finance/:rideId` | Owner, Finance | Payment attempts and internal record checks |
| `/admin/compliance` | Owner, Operations | Driver review, document expiry and follow-up queues |
| `/admin/compliance/:driverId` | Owner, Operations | Current document metadata and internal follow-up tasks |
| `/admin/demand` | Owner, Operations | Demand by area and time, journey outcomes and current driver coverage |
| `/admin/coverage` | Owner, Operations | Nationwide demand map, observed pickup waits and current coverage |

Existing administrators retain Owner access. Other staff receive these pages
through their assigned roles. Finance access does not grant passenger profiles,
trip addresses, private documents or safety evidence. Operations access does not
grant financial records, document downloads or driver approval authority.

## Finance centre before Paystack

The centre reports the existing ride and parcel/courier payment simulations.
Every monetary view states that no money moved. Historical simulations retain
their original mode; adding this dashboard cannot convert them into real charges.
Eats orders do not yet have a payment ledger and are explicitly excluded.

The default period is the last 30 Nigeria calendar dates, inclusive. Date filters
use Africa/Lagos (WAT), with a maximum 366-day range. The cohort uses the payment's
saved trip-completion timestamp. Status is the current saved status at refresh,
so this is not a historical accounting balance as of the selected end date.
Summary totals cover the complete filtered cohort, not just the displayed page.
Amounts are added as exact integer kobo and returned as decimal strings.

The ledger provides search, status/date filters, stable pagination and a detail
view of payment attempts. A retry does not multiply the trip's fare in totals.
Internal checks flag inconsistent attempts/receipts and old pending records for
investigation. These checks compare Taxi AI records only: they are not provider
verification, bank reconciliation or evidence that funds settled.

The Paystack connection, transaction fees, platform commissions, refunds and
driver/vendor payouts are unavailable. Their values remain unset, rather than
displaying invented zero balances. Staff cannot charge, refund, settle or change
a payment from this workspace. Those actions require a separate provider-backed
payment integration and business rules.

The API excludes participant identities, route labels, precise locations,
payment-card information and raw receipt payloads. Payment references and minimal
receipt metadata are sufficient to inspect the saved financial record. Detail
reads are audited.

## Driver compliance

The queue uses existing driver application and document records. It identifies
submitted applications, missing documents, expired documents, documents expiring
within 30 days and drivers currently eligible for new work. Document expiry
follows the same Nigeria date boundary as driver eligibility; a document is valid
through its recorded expiry date. An approval alone does not imply eligibility
when required documents are missing or expired.

Summary counts cover all active drivers matching the search, regardless of the
selected queue or follow-up filter. Document categories can overlap.

The workspace excludes deleted Work profiles and exposes a limited projection:
driver name, vehicle plate, application status, document kinds/expiry dates and
follow-up history. It does not return document files, licence numbers, personal
contact details or complete historical application payloads. Owners continue to
use the existing protected document-review workflow for approval decisions.

An Owner or Operations member can record a dated internal follow-up task and
complete it with a note. The screen labels these as staff reminders. Saving a
task does not send an email, SMS or push notification to the driver. Due dates
entered in the browser are interpreted as WAT, independent of the computer's
local timezone. Version checks and idempotency keys prevent stale overwrites and
duplicate actions; changes and their reasons are recorded in the audit trail.
Tasks retain the application version they refer to. If the driver changes their
application, the detail page flags the older task for staff review.
These tasks do not approve, reject, suspend or otherwise change driver eligibility.

## Demand analytics

Demand uses journey requests created within the selected inclusive WAT date
range, defaulting to seven dates and bounded to 90 days. Staff can distinguish
passenger rides from parcel/courier requests and inspect aggregate area coverage
and daily/hourly activity. Eats orders are a separate service and are not counted
as ride requests.

Completion, cancellation, expiry and matching figures state their cohorts and
denominators. Request-to-match timing uses recorded timestamps rather than an
estimated pickup arrival time. Offer outcomes include expired offers even when
background maintenance has not yet updated their stored status.

Available-driver supply is a snapshot at the displayed observation time. It is
shown separately from historical request totals and applies current approval,
document, session/lease and busy-work eligibility. It is not historical driver
supply or a prediction of who will accept a request.

Sample/demo area data is labelled separately from coarse GPS dispatch cells.
The page contains no individual passenger or driver identifiers, precise GPS,
private addresses or household-level maps. Unknown areas are not assigned an
invented city. No external map request or new location collection is needed.
Demand analytics is read-only and does not change negotiated or agreed fares.

The [nationwide coverage map](nationwide-coverage-map.md) adds GPS grid layers,
city navigation, observed booking-to-arrival waits and a separate current coverage
snapshot. Sample areas remain off that map; city shortcuts are approximate views.

## Storage and verification

SQLite migration 36 and PostgreSQL migration 8 add the compliance follow-up
records and indexes. Existing driver applications, payments and journeys remain
unchanged. Apply migrations using the application's existing startup/migration
workflow and retain a compatible backup when upgrading saved data.

Root tests cover the new backend services and HTTP permissions, finance
arithmetic and record integrity, document expiry and follow-up transactions,
demand aggregation, and frontend role/navigation/form behaviour. PostgreSQL
integration tests require an isolated test database. Embedded PostgreSQL
compatibility checks do not establish production capacity or concurrent load.
