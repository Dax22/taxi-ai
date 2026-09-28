# Explainable pickup and waiting priority

Taxi AI's default `pickup-eta-wait-v1` policy allocates exclusive driver invitations
using road pickup estimates and customer waiting time. It is a deterministic
algorithm, with optional batch optimization. No trained model or LLM selects a
driver, sets a fare or confirms a booking. See [dispatch setup](dispatch.md) for
configuration, limits, fallback behavior and measurements.

## Eligibility comes first

The server checks approval, vehicle category, delivery capacity, current workload,
availability ownership, fresh consented location, sample/GPS separation, radius
and request deadline. A driver and request can each have only one pending offer.
Already attempted driver/request pairs are excluded. After routing I/O, the server
checks current eligibility again before saving the offer. Claiming also verifies
the driver's current offer and ride version inside the existing transaction.

## Allocation policy

The pure policy in `packages/shared/src/dispatch.mjs` takes already-eligible
driver/request pairs. Its limits are 32 drivers, 32 requests and 512 edges. It
retains older requests when the candidate graph exceeds its capacity. These bounds
mean an optimal result within the selected graph is not a city-wide optimum.

| Signal | Current policy |
| --- | --- |
| Road pickup estimate | Provider duration, accepted only when valid and recent |
| Missing road estimate | Internal distance cost of metres / 5, plus a 300-second penalty |
| Local sample match | Fixed internal 900-second cost, plus the same 300-second penalty |
| Waiting credit | One cost unit per second waited, capped at five minutes |
| Two-minute priority | Additional 7,200-unit waiting credit after at least two minutes |
| Equal costs | Stable ordering by request age, request ID and driver ID |

Lower total cost is preferred. Fallback and sample costs are ranking heuristics;
their numeric values are never presented as pickup predictions. The waiting
threshold and weights are product settings, not learned or empirically validated
claims. They improve priority within this bounded policy but cannot guarantee that
every rider will be served before request expiry.

`sequential` mode greedily selects the best remaining compatible pair, then removes
that driver and request from the current allocation. Optional `batch` mode uses
minimum-cost maximum-flow: it first maximizes the number of compatible pairings,
then minimizes the sum of pickup/waiting costs. Residual edges allow it to revise an
earlier tentative pairing. This is not a copy of Uber's proprietary algorithm.

No customer profile, premium flag, fare, rating or invented acceptance history
changes this score. Fare negotiation starts only after the driver claims the
invitation, and still requires explicit offer acceptance and customer confirmation.

## Road estimates and fallback

The configured OSRM adapter returns road travel duration without live traffic.
Its pickup table processes at most 16 uncached directed pairs per request; other
pairs use the explicit fallback in that matching cycle. Provider errors, missing
routes, stale or invalid results and timeouts do not become fabricated ETAs.

The driver card shows rounded pickup minutes only for a valid road estimate. Other
offers explain that road time is unavailable or that the request is a local sample.
Approximate areas and rounded distance remain visible; precise coordinates, route
geometry, personal details and numeric policy costs remain private before claiming.

## Legacy comparison

`TAXI_AI_DISPATCH_MODE=legacy` retains the earlier `proximity-wait-v1` list. It ranks
eligible requests by 75% pickup proximity (`1 - metres / 10,000`) and 25% waiting
time (age / five minutes, capped at 1). Ties use oldest creation time and request
ID; sample requests use waiting time. The API returns up to 50 eligible requests,
and the first valid atomic claim selects the driver. The radius still expands
from 5 km to 10 km after a minute without changing the fixed distance denominator.

This mode is retained for operational comparison and recovery. It does not use timed
invitations or require an invitation ID. The new mode can be selected by configuration
without discarding fare history or changing confirmed journeys.

## Where ML could fit later

Representative, consented operational data could support evaluated pickup-time or
acceptance models behind the existing estimate interface. Current measurements
record matching, pickup and outcome aggregates by mode and sample/GPS cohort.
They establish a baseline; they do not prove a gain over legacy matching. Compare
similar service areas, demand, driver supply, expiry and cancellation rates before
claiming improvements. Sample journeys must remain separate from real device data.
