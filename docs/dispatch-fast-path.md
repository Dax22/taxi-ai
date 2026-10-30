# Taxi Ai — Dispatch Performance and Verified Fare Advisory (development)

This branch is a **safe, opt-out performance candidate**, not the live Tencent release. It is based on GitHub `main`, which is behind the newer supervisor worktree currently resident on Tencent. Reconcile changes against that worktree before deployment. Do **not** merge/deploy automatically while the production supervisor schema migration is pending.

## Dispatch improvement

- Keeps the existing region partitioning, PostGIS candidate search, GPS freshness, approval, vehicle eligibility, workload checks, driver-sees-destination behavior, routing timeouts, worker leases, and transactional revalidation.
- Adds `dispatch-fast-matching.mjs`, an exact queue-based minimum-cost maximum-cardinality solver over the *existing bounded graph* (at most 32 drivers, 32 rides, 512 edges).
- The batch dispatch path uses the faster solver by default when `TAXI_AI_DISPATCH_MODE=batch`; all other dispatch modes are unchanged.
- Set `TAXI_AI_BATCH_SOLVER=legacy` to use the original Bellman-Ford algorithm. Any fast-solver limit/error automatically falls back to the original algorithm. This switch supports canary and rollback.
- Strictly no change to ride/driver eligibility or fare negotiation logic.
- Before enabling batch mode in production, run full PostgreSQL integration tests and production-like load tests with the same traffic trace for `fast` and `legacy`. Compare offer latency, DB query time, route-provider latency, completed/accepted assignments, long-wait percentiles, double-assignment checks, and resource use.

### Local synthetic benchmark (Node 22; not a production claim)

The isolated solver test compared 50 generated bounded graphs, 500 timed iterations for each algorithm, and verified both algorithms produced the same maximum number of assignments and minimum total cost on every graph. On that run, Bellman-Ford P95 was about 1.29 ms and the queue-based solver P95 about 0.76 ms (~1.7×). Results vary by machine/workload. The overall booking and ETA pipeline may be dominated by PostgreSQL, network, driver availability, or route-provider latency.

## Pricing intelligence foundation

- Adds `cost-aware-fare.mjs` as a **read-only advisory**, not an automatic charge or an override of currently agreed fares.
- Requires independently sourced, vetted and fresh road distance/time estimates and a current approved fuel-price reference. Stale/missing inputs return `unavailable` instead of inventing prices.
- Accepts a reviewed, versioned policy for base/km/minute rates, maintenance/km cost, vehicle fuel consumption and minimum driver earnings; does not ship arbitrary real-world fuel prices or rate assumptions.
- Uses integer kobo arithmetic, a 10% commission invariant and a transparent operating-cost floor with a configured maximum fare. If the floor breaches the cap, it refuses a quote.
- User and driver must still both accept any new fare using Taxi Ai's existing in-app negotiation flow.
- Real pricing optimization requires a reviewed Nigeria-specific cost feed and empirical completion/acceptance data, plus fairness and consumer-protection evaluation. Do not auto-adjust fares or surge rates from unvalidated models.

## Verification and rollout conditions

1. Run `npm run check` and the existing full test suite on the branch.
2. Run `node --test packages/shared/test/dispatch-fast-matching.test.mjs packages/shared/test/dispatch.test.mjs packages/shared/test/cost-aware-fare.test.mjs`.
3. Run native PostgreSQL and matching benchmark jobs. Confirm no decrease in match cardinality or meaningful deterioration in wait-time fairness.
4. Merge/rebase this branch into the latest **Tencent supervisor feature worktree**, not straight into the deployed image. Update supervisor's Matching/Pricing agent registry from the staged package and increase agent count to eight.
5. Rebuild release images from the exact live base; rehearse migration and startup in disposable PostgreSQL, and perform canary/rollback tests. Keep production on schema 42 until the approved human-driven schema-43 migration step is completed.

**No matching-performance claim is made for the current live Taxi Ai site, and no pricing automation is enabled by this branch alone.**
