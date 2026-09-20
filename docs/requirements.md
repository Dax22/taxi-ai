# Product requirements

These requirements capture the product decisions made so far. Unless the README
says a feature is implemented, it remains planned.

## Launch market and services

- Brand: **Taxi Ai**. Initial operating area: Abuja, Nigeria.
- Currency: NGN. Store monetary amounts as integer kobo (100 kobo = 1 naira).
- Taxi Ai rides: customer requests a driver for a car journey.
- **Taxi Ai Eats**: food ordering from participating vendors, with delivery by
  motorcycle or an appropriate larger vehicle.
- Courier: motorcycles for suitable small parcels, cars/vans for larger loads.
  Actual size, weight, coverage and prohibited-item rules need definition.
- Motorcycle delivery is in scope. Motorcycle passenger rides are not part of the
  current product requirements.
- Robotaxis/autonomous taxis: display **Coming soon** only. Do not offer booking,
  claim operational availability or invent a launch date.

## People and interfaces

| Role | Planned capabilities |
| --- | --- |
| Customer | Request a ride, negotiate fares, order food, send parcels and track progress |
| Driver / delivery rider | Complete onboarding, receive requests, negotiate eligible fares and carry out trips or deliveries |
| Food vendor | Manage menus, availability, orders, preparation and handover |
| Administrator / support | Manage service operations, onboarding, disputes and safety cases with audited access |

Build a responsive web booking experience. Plan customer and driver applications
for iOS and Android with layouts suitable for phones and tablets. Vendor and
administrator web portals will be separate role-based areas. Their detailed flows
will be designed in a later milestone.

## Fare agreement

1. The app suggests a fare before negotiation. This is guidance, not a binding
   price. A production estimator needs local operating data and validation.
2. Either customer or driver can submit a proposed fare and the other can
   counteroffer. No party can accept their own offer.
3. Users may negotiate with structured offer buttons, text chat, or a private
   in-app internet voice call. Do not expose their real phone numbers.
4. Chat and calls lead to an explicit in-app fare offer. Free text, a transcript,
   or an AI interpretation cannot confirm or change a price automatically.
5. Submitting an offer is the sender's explicit consent to that amount. The UI
   must make this clear. The other person's acceptance of that exact current
   offer completes both parties' agreement.
6. Superseded and expired offers cannot be accepted. A counteroffer replaces the
   prior active offer. Store the agreed fare and audit history before confirming
   a booking. A fare agreement alone does not dispatch a vehicle or take payment.
7. Once agreed, the fare cannot be silently changed. Any future trip-change or
   cancellation policy must be explicit and designed before implementation.

Ride negotiation is the first implementation target. Whether courier prices also
use negotiation is an open product decision. Food menu prices and the displayed
delivery fee are confirmed at checkout; paid food orders are not renegotiated.

## Design direction

The website reference is the user's [Wix template](https://www.wix.com/website-template/view/html/wh-1058).
Use it as inspiration for a modern, spacious autonomous-mobility theme with
original Taxi Ai branding and assets. Prioritize booking clarity, legible controls,
accessible contrast and touch layouts on smaller screens.

## AI and safety

Candidates include fare/ETA prediction, driver matching assistance, multilingual
help, food search and human-reviewed fraud or unusual-trip alerts. Validate each
against actual user needs and available data; none exists in this foundation.

The current preview includes recorded driver review, trip-start PINs, private
communication, reporting and [Trip Safety](safety.md): trusted contacts, manual test
SOS, private trip links and administrator incident review. Contact delivery is
simulated. External identity verification, real notification delivery and staffed
emergency assistance remain separate milestones.
Detection models must support a staffed response process and should not claim to
guarantee safety. Call recording and retention are undecided and must not be
enabled silently.

## Decisions still needed

- First Abuja coverage zones and onboarding process.
- Production payment, mapping and internet-calling providers. The local map
  preview uses public Photon/OSRM/OSM services; this is not a production selection.
- Fare estimator inputs, business limits, platform commission and cancellation rules.
- Delivery rates, courier item/vehicle limits and vendor commercial arrangements.
- Support operations, safety response, retention and access policies.
- Web/mobile frameworks and hosting choices when implementation begins.
