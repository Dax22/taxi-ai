# Nationwide demand and coverage map

Open `/admin/coverage` with an Owner or Operations staff account. The page uses
the same protected staff session and `demand.read` permission as demand analytics.
It reads records from the shared backend used by web, iOS and Android. It does
not expose a new public or driver-facing reporting API.

## Geography and navigation

The map covers Nigeria. Pan and zoom work outside the city shortcut catalogue;
recorded GPS activity does not need a predefined city to appear. City and district
shortcuts move to approximate map views. They are navigation anchors, not official
city, district or operational-zone boundaries. The viewport is a rectangle, and
its counts include the recorded positions inside that rectangle.

The map groups activity into a regular latitude/longitude grid. Resolution adjusts
to the viewport, with a minimum cell size of 0.01 degrees, approximately one
kilometre north–south. Grid lines can cross neighbourhood boundaries. A cell near
Wuse or Maitama is not an exact count for the administrative neighbourhood.
National views use larger cells so the response remains bounded without dropping
lower-volume areas from a top-N map.
Effective query bounds snap to whole cells, so moving a viewport by tiny amounts
cannot probe for a precise passenger or driver position within one cell.

Only aggregate cell bounds and metrics reach the browser. Individual pickup pins,
driver positions, identities, trip IDs, addresses and saved route payloads remain
private. The existing booking flow validates Nigerian GPS locations before saving
them. Records without usable saved pickup coordinates, including sample locations,
stay off the GPS map rather than acquiring invented coordinates.

The outline and place catalogue are bundled with the application. No map API key,
external tile request or geocoding call is needed to open or navigate this page.
Place-source and licence attribution is included in the map and source module.
The catalogue contains 74 navigation anchors covering all 36 states and the FCT,
including Wuse, Wuse II and Maitama. Natural Earth v5.1.2 supplies the country
outline and most city points; GeoNames and a versioned OpenStreetMap point supply
additional navigation anchors. Their source URLs, versions or retrieval dates,
licences and available download hashes are retained in
`packages/shared/src/nigeria-map-places.mjs`.

## Measures

| Measure | Definition |
| --- | --- |
| Historical requests | Requests created in the selected inclusive Nigeria calendar dates; default seven dates, maximum 90 |
| Unserved requests | Requests that expired without a match; passenger cancellations are separate |
| Observed pickup wait | Driver arrival time minus booking confirmation time, using valid recorded observations |
| Pickup observations | Number of journeys contributing to the pickup-wait mean; missing observations are not zero waits |
| Waiting requests now | Currently unmatched, nonexpired requests, independent of the historical date filter |
| Available drivers now | Currently eligible, unreserved drivers with valid availability and session leases |

Historical request outcomes are current at the displayed refresh time. Pickup
waiting time begins after booking confirmation; it is not request-to-match time,
time to passenger boarding or a predicted pickup ETA. Missing, negative or future
timing observations are excluded from that mean.

The current coverage layer measures waiting requests and available drivers at one
observation time. It does not divide historical demand by today's supply. A driver
in a nearby cell may still serve a request, and negotiation, service compatibility
and travel time affect matching. Cell comparisons do not guarantee a shortage,
acceptance or future availability.

Samples and records without usable coordinates are reported separately with a
nationwide scope. They cannot be assigned to the selected city view. Viewport,
outside-viewport and off-map counts reconcile to the filtered nationwide totals.
Date filters apply to historical demand; service filters apply to both historical
and current measures. Eats orders are not included in ride/courier request demand.

## Implementation and limits

`admin-demand` owns the read-only coverage API at
`GET /api/admin/console/demand/coverage`. The repository aggregates saved pickup
coordinates and eligible availability into cells before returning a response.
The service validates dates, layers and geographic bounds, checks current staff
access and supplies explicit cohort and resolution metadata.

The staff frontend separates map projection/navigation, SVG rendering and page
composition. A numeric area table accompanies the visual layers. Existing session,
role-change and authenticator checks remain in effect. This feature does not
change dispatch, fare negotiation, payment handling or driver approval.

No schema migration, new npm dependency or provider credential is required.
Automated checks cover nationwide navigation data, grid bounds, metric cohorts,
privacy, staff access, frontend behaviour and SQLite/PostgreSQL compatibility.
Those checks do not establish million-user capacity or replace browser/device
visual acceptance.
