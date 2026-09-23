# Nigeria-wide coverage

Taxi Ai supports Nigerian locations across the website, native app, Eats and
operations dashboard. This remains a development preview. Supporting a location
does not mean a driver or kitchen is operating there; available requests and food
must come from eligible local participants.

## Rides and courier journeys

Address search uses a Nigeria country filter and national search extent. The server
and clients validate coordinates against the shared country polygon, including
pickup/destination points, road geometry and driver GPS. A neighboring-country
point cannot pass merely because it falls inside the national bounding rectangle.
Include the city or state in a search to distinguish similarly named places.

Road previews accept routes up to 2,500 km and 48 hours. This is a validation limit,
not an interstate-service promise. Suggested fares remain illustrative; they do
not use validated local tariffs or live traffic. The existing local driver-matching
radius remains 5 km, expanding to 10 km. GPS consent, freshness, accuracy, approved
vehicles and one-job capacity rules remain in force.

The small Abuja sample list remains a clearly labelled, local-development fixture.
It is independent of nationwide address/GPS support and cannot match live GPS
requests. Saved sample journeys and fares retain their original IDs and values.

## Eats location and coverage

Choose a state or the Federal Capital Territory and enter a city, town or district.
The same controls serve customers and restaurant, food-vendor and home-kitchen
owners. The town field is not restricted to a finite city list. Canonical IDs
combine the state and normalized town text, so similarly named towns in different
states remain separate. Existing Abuja area IDs are preserved.

Customers enter their delivery location before searching food. Kitchens explicitly
choose the towns/areas they deliver to; a new kitchen defaults to its own selected
area. Older stores with no saved coverage retain only the original seven areas,
never all of Nigeria. Food search and checkout enforce the selected coverage.
Town labels are user-entered delivery areas, not verified postal addresses or
geocoded service boundaries. Spelling aliases are not automatically merged.

Restaurants display their business address. Food vendors and home kitchens show
their name and town/state without exposing a street address. Their order-specific
collection point keeps its existing participant/stage privacy rules.

## Nearby food couriers

A kitchen owner can explicitly save their current location as a private courier
pickup point. Capture it while at the intended pickup place. It is used for nearby
matching and is absent from public kitchen listings, food results, quotes and
customer/courier order views. Changing the point requires another store review.
New delivery kitchens outside the legacy sample areas need this point before
they can operate and accept delivery orders. Pickup-only kitchens can operate
without it.

GPS couriers can discover and claim only ready orders within 10 km of the saved
pickup point. The server checks this again at claim. Legacy orders without a
configured point cannot be claimed through GPS matching; their local sample
fixtures remain available for testing. A location permission denial does not fabricate a point.

Each placed order retains its pickup point separately from its public snapshot.
Moving a store later cannot relocate an existing courier job. Customer pickup
does not require a courier GPS point. These controls do not calculate delivery
road distance, verify reported GPS, or provide a live arrival-time estimate.

## Data, compatibility and release checks

Country geometry is pinned to Natural Earth v5.1.2, 1:10m Admin 0 Countries,
Nigeria record `ADM0_A3=NGA`. The original polygon vertices are retained in
`packages/shared/src/nigeria-boundary.mjs`, with the source URL, license and
SHA-256 checksum. Natural Earth's map-scale boundary is not a surveyed border;
border/coastal cases require provider/device acceptance checks.

Schema 23 adds private store and order dispatch-point tables without rewriting
accounts, trips, menus, food orders, receipts or guest links. These coordinates
are private persistent business data and remain in backups. Back up before
upgrading; older servers cannot read the new schema. Existing stores are not
silently assigned coordinates or enrolled into new delivery areas.

Before release, exercise real address search, route results and permission flows
in multiple cities and near coverage boundaries. Verify local driver/kitchen
onboarding and map-provider capacity, plus desktop/mobile layouts and physical
devices. This change supplies nationwide software support; production dispatch,
real payments and local operational availability require their own rollout.
