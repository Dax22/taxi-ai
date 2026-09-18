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
preview access. Vendor/customer/driver authentication remains a later milestone.

## 2 — Real ride pilot

Add accounts, approved drivers, database persistence, maps, vehicle matching,
booking state, receipts and payment-provider integration. Implement authenticated
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
