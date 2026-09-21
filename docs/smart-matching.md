# Explainable request ranking

Taxi AI now orders eligible requests using a deterministic policy named
`proximity-wait-v1`. It is a matching algorithm, not an AI agent or trained model.
It improves the driver's available-work list; it does not choose a driver for the
customer, dispatch a vehicle, accept a fare or guarantee an arrival time.

## Eligibility comes first

The existing server checks approval, vehicle category, delivery capacity,
availability, fresh consented location, active workload, sample/GPS separation,
search radius and request expiry before a request can be selected. Ranking follows
the existing candidate filters, before the 50-result limit. Atomic claim rechecks
eligibility and version. Drivers can choose any eligible request, regardless of rank.

## Initial policy

| Signal | Weight | Normalization |
| --- | --- | --- |
| Pickup proximity | 75% | `1 − straight-line metres / 10,000` |
| Customer waiting time | 25% | Request age divided by five minutes, capped at 1 |

Higher scores appear first. Equal scores sort by older creation time, then stable
request ID. The fixed distance scale avoids an artificial score jump when a
request's search radius expands from 5 km to 10 km. Sample-area requests have no
distance signal and sort by waiting time, with the same stable tie handling.
Expired requests never gain priority; their existing five-minute deadline applies.

These weights are explicit initial product choices, not validated estimates of
conversion or pickup time. A request waiting three minutes may outrank a new
request about a kilometre closer; very distant requests still lose to nearby ones.
No fare, premium flag, customer profile, ratings or invented performance history
changes the score. An established search area is only an eligibility boundary.

## Explanations and privacy

Mobile and web show the distance/wait ordering and concise reasons: pickup within
2 km, within the search area, matching sample area, or a wait of at least one minute.
The API returns a policy version and rank, plus allowlisted reason codes. Existing
rounded pickup distance and approximate pickup/destination areas remain the public
projection. Numeric scores stay internal because they could disclose exact
straight-line distance. No extra location collection or database migration is added.

The new recommendation field is optional in the mobile response parser to keep
older servers compatible. When present its version, rank and reasons are validated.
Physical device/GPS and layout checks are separate from automated verification.

## Where AI could fit later

After representative trip data exists, an evaluated model could estimate pickup
time or acceptance likelihood and provide bounded inputs to a new policy version.
An optional assistant could explain recommendations or clarify a booking request.
Neither needs authority to bypass eligibility, accept fares or dispatch transport.
Measure pickup delay, request expiry, cancellation, recommendation stability and
coverage across service areas before changing the initial weights. Road ETA and
traffic estimates require a real routing provider; this policy never labels
straight-line distance as an ETA.

Automated coverage includes distance/wait tradeoffs, deterministic ties, invalid
and expired inputs, private API projections, native delivery/passenger contracts,
explicit lower-rank claims and the existing eligibility/concurrent-claim tests.
