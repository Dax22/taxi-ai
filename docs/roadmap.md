# Delivery milestones

## 0 — Repository foundation (implemented)

- Record the accepted product scope and open decisions.
- Establish the app, service, shared code and documentation directories.
- Implement and test explicit fare offers, counteroffers and agreement.
- Provide a local terminal demonstration.

## 1 — First browser experience (implemented preview; visual review pending)

The Taxi Ai landing page and ride-request form now use clearly identified sample
locations and fictional fares. Eats, courier and autonomous taxis have accurate
availability labels. The local demo connects suggestion, offer/counteroffer and
confirmation to the tested shared fare module, with mobile/tablet/desktop CSS.

Complete the manual browser review in `apps/web/README.md` before treating layout
and end-to-end interaction as verified. The current cloud browser blocked local
preview access. Vendor authentication remains a later milestone.

## 2a — Local accounts and saved ride requests (implemented; browser review pending)

- Customer/driver password accounts and role-specific dashboards.
- Local first-administrator setup and pending driver approval with vehicle details.
- SQLite storage, session cookies and server-side access checks.
- Persistent test requests, exclusive driver claiming, fare negotiation and history.
- Versioned transactions, duplicate-request protection and server-controlled expiry.
- Three-second dashboard polling, separate browser sessions and restart durability.

This milestone uses sample areas and fictional fares. Approval enables local
testing; identity and vehicle verification are not implemented. An agreed test
fare does not dispatch a car. Follow the manual checklist in `apps/web/README.md`.

## 2b — Real ride pilot

Harden authentication and hosting; add verified driver onboarding, maps, vehicle
matching, operational booking state, receipts and payment-provider integration. Implement authenticated
chat and private voice calls. Exercise concurrency, permission checks and
recovery from interrupted requests before enabling real transactions.

## 3 — Delivery and operations

Build food-vendor menus and order management, courier parcel workflows,
motorcycle delivery, larger-vehicle selection and operational support tools.
Pilot coverage, delivery capacity and vendor operations before expanding.

## 4 — Mobile and intelligence

Deliver the customer and driver apps for iOS/Android, with tablet layouts.
Add evaluated fare/ETA models and bounded AI assistance as data and operational
readiness permit. The website and native app milestones can overlap once their
shared API is stable.

## Future — Autonomous services

Keep robotaxi bookings unavailable until suitable operating partners, vehicles,
service readiness and applicable approvals are established. No date is committed.
