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

| Profile or membership | Planned capabilities |
| --- | --- |
| Customer | Request a ride, negotiate fares, order food, send parcels and track progress |
| Driver / delivery rider | Complete onboarding, receive requests, negotiate eligible fares and carry out trips or deliveries |
| Food vendor | Manage menus, availability, orders, preparation and handover |
| Administrator / support | Manage service operations, onboarding, disputes and safety cases with audited access |

Deliver one Taxi Ai mobile application for iOS and Android and one responsive
website, with layouts suitable for phones and tablets. Both use the same account,
backend and saved activities. One person may hold several approved service
capabilities and vendor/store memberships; do not require a separate login for
each role. Customer, Drive & deliver and My store are the three navigation modes.
Vendor tools are available within both clients when implemented. Administrator
operations remain a restricted staff area outside the public mode selector.

A mode switch never grants permission, cancels active work or accepts a fare.
The backend checks membership, eligibility and resource ownership for each action.
Prevent self-assignment and conflicting work across services/devices. Preserve
active-activity navigation and clear private client state on context changes.
See [the unified platform plan](unified-platform.md) for navigation, migration,
reliability requirements, platform differences and delivery order. This is the
target design. The current prototype implements Customer and Work for rides under
one personal account. Native accounts, driver onboarding and customer ride requests
are implemented; native negotiation/trip controls, delivery and stores remain planned.
See [unified accounts](unified-accounts.md) for implementation and migration.

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

Retain the user's yellow Taxi Ai branding and current light 3D city/autonomous
homepage theme. The original [Wix reference](https://www.wix.com/website-template/view/html/wh-1058)
remains background inspiration. Use consistent labels and design tokens across
web and mobile; prioritize task clarity, readable status, accessible controls
and touch layouts. Show only the selected mode's working navigation, with a
clear switcher for other approved modes and a return path to active work.

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
- Native signing, physical-device acceptance and production identity hardening.
  The Expo/React Native/TypeScript stack, locked dependencies and device sessions
  are implemented alongside the web client. Alibaba Cloud hosting setup is paused.
