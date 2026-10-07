import { EXPANDED_RADIUS_METERS, REQUEST_MS } from './matching.mjs';

/** Deterministic dispatch rules. These are policy settings, not learned weights. */
export const DISPATCH_POLICY = Object.freeze({
  version: 'pickup-eta-wait-v1', offerTtlMs: 20_000,
  maxDrivers: 32, maxRides: 32, maxEdges: 512,
  maxPickupEtaSeconds: 7200, maxDistanceMeters: EXPANDED_RADIUS_METERS,
  fallbackSpeedMetersPerSecond: 5, fallbackPenaltySeconds: 300,
  samplePickupCostSeconds: 900, waitingPriorityMs: 120_000,
  waitingCreditLimitMs: REQUEST_MS,
});

export const DISPATCH_REASON_LABELS = Object.freeze({
  road_pickup_eta: 'Ranked using an estimated pickup time on roads',
  distance_fallback: 'Road estimate unavailable; ranked using approximate distance',
  sample_area: 'Matches your selected sample area; no road estimate available',
  waiting_priority: 'Customer has waited at least two minutes',
});

const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 128;

function scoreEdge(candidate, now, costForCandidate = null) {
  const p = DISPATCH_POLICY;
  if (candidate === null || typeof candidate !== 'object'
    || !validId(candidate.driverId) || !validId(candidate.rideId)
    || !Number.isSafeInteger(candidate.createdAt) || candidate.createdAt < 0 || candidate.createdAt > now
    || !Number.isSafeInteger(candidate.expiresAt) || candidate.expiresAt <= now
    || !(candidate.pickupEtaSeconds === null || Number.isFinite(candidate.pickupEtaSeconds)
      && candidate.pickupEtaSeconds >= 0 && candidate.pickupEtaSeconds <= p.maxPickupEtaSeconds)
    || !(candidate.distanceMeters === null || Number.isFinite(candidate.distanceMeters)
      && candidate.distanceMeters >= 0 && candidate.distanceMeters <= p.maxDistanceMeters)) return null;

  const ageMs = now - candidate.createdAt;
  const etaSource = candidate.pickupEtaSeconds !== null ? 'road'
    : candidate.distanceMeters !== null ? 'distance_fallback' : 'sample';
  // All costs have units of seconds. Only the road provider's ETA is an ETA;
  // fallback costs are internal ranking heuristics and must never be advertised.
  const pickupCost = etaSource === 'road' ? candidate.pickupEtaSeconds
    : (etaSource === 'distance_fallback' ? candidate.distanceMeters / p.fallbackSpeedMetersPerSecond
      : p.samplePickupCostSeconds) + p.fallbackPenaltySeconds;
  const priority = ageMs >= p.waitingPriorityMs;
  const waitingCredit = Math.min(ageMs, p.waitingCreditLimitMs) / 1000
    + (priority ? p.maxPickupEtaSeconds : 0);
  const reasons = [etaSource === 'road' ? 'road_pickup_eta' : etaSource === 'sample' ? 'sample_area' : 'distance_fallback'];
  if (priority) reasons.push('waiting_priority');
  const learned = typeof costForCandidate === 'function' ? costForCandidate(candidate) : null;
  // A learned ranker may replace only the relative candidate cost. The existing
  // two-minute waiting priority remains a deterministic guard, and any missing
  // or invalid model score falls back to the reviewed deterministic policy.
  const cost = Number.isFinite(learned) && Math.abs(learned) <= 1_000_000_000
    ? Math.round(learned) - (priority ? 2_000_000_000 : 0)
    : Math.round((pickupCost - waitingCredit) * 1000);
  return { candidate, etaSource, reasons, cost };
}

const compareEdges = (a, b) => a.cost - b.cost || a.candidate.createdAt - b.candidate.createdAt
  || compareId(a.candidate.rideId, b.candidate.rideId) || compareId(a.candidate.driverId, b.candidate.driverId)
  || a.candidate.expiresAt - b.candidate.expiresAt
  || (a.candidate.pickupEtaSeconds ?? Infinity) - (b.candidate.pickupEtaSeconds ?? Infinity)
  || (a.candidate.distanceMeters ?? Infinity) - (b.candidate.distanceMeters ?? Infinity);

function boundedEdges(candidates, now, costForCandidate = null) {
  const scored = candidates.map((candidate) => scoreEdge(candidate, now, costForCandidate)).filter(Boolean);
  // When a city exceeds this worker's budget, retain the oldest eligible rides.
  // The guarantee below applies to this bounded graph, not every city request.
  const oldest = [...scored].sort((a, b) => a.candidate.createdAt - b.candidate.createdAt
    || compareId(a.candidate.rideId, b.candidate.rideId));
  const rides = new Set();
  for (const { candidate } of oldest) {
    if (rides.size < DISPATCH_POLICY.maxRides) rides.add(candidate.rideId);
  }
  const ranked = scored.filter(({ candidate }) => rides.has(candidate.rideId)).sort(compareEdges);
  const pairs = new Set(), unique = [];
  for (const edge of ranked) {
    const { driverId, rideId } = edge.candidate;
    const key = JSON.stringify([driverId, rideId]);
    if (pairs.has(key)) continue;
    pairs.add(key); unique.push(edge);
  }
  // Reserve drivers needed for maximum cardinality before filling spare slots.
  // Selecting only the cheapest drivers could omit another ride's only match.
  const drivers = new Set(cardinalitySkeleton(unique).map(({ candidate }) => candidate.driverId));
  for (const { candidate } of unique) {
    if (drivers.size >= DISPATCH_POLICY.maxDrivers) break;
    drivers.add(candidate.driverId);
  }
  const edges = unique.filter(({ candidate }) => drivers.has(candidate.driverId));
  if (edges.length <= DISPATCH_POLICY.maxEdges) return edges;
  // Both node sets are already bounded, so at most 32 * 32 unique edges reach
  // this step. Retain a maximum-cardinality skeleton before discarding edges;
  // otherwise a dense graph's cheapest 512 edges could omit half its rides.
  const kept = new Set(cardinalitySkeleton(edges));
  for (const edge of edges) {
    if (kept.size >= DISPATCH_POLICY.maxEdges) break;
    kept.add(edge);
  }
  return edges.filter((edge) => kept.has(edge));
}

function greedyAllocation(edges) {
  const drivers = new Set(), rides = new Set(), chosen = [];
  for (const edge of edges) {
    const { driverId, rideId } = edge.candidate;
    if (drivers.has(driverId) || rides.has(rideId)) continue;
    drivers.add(driverId); rides.add(rideId); chosen.push(edge);
  }
  return chosen;
}

function cardinalitySkeleton(edges) {
  const byDriver = new Map();
  for (const edge of edges) {
    const id = edge.candidate.driverId;
    if (!byDriver.has(id)) byDriver.set(id, []);
    byDriver.get(id).push(edge);
  }
  const initial = greedyAllocation(edges);
  const byRide = new Map(initial.map((edge) => [edge.candidate.rideId, edge]));
  const rideCount = new Set(edges.map((edge) => edge.candidate.rideId)).size;
  const matchedDrivers = new Set(initial.map((edge) => edge.candidate.driverId));
  const augment = (driverId, visited) => {
    if (visited.has(driverId)) return false;
    visited.add(driverId);
    for (const edge of byDriver.get(driverId)) {
      const previous = byRide.get(edge.candidate.rideId);
      if (previous && !augment(previous.candidate.driverId, visited)) continue;
      byRide.set(edge.candidate.rideId, edge); return true;
    }
    return false;
  };
  for (const driverId of [...byDriver.keys()].sort(compareId)) {
    if (byRide.size === rideCount) break;
    if (!matchedDrivers.has(driverId)) augment(driverId, new Set());
  }
  return [...byRide.values()];
}

function batchAllocation(edges) {
  const driverIds = [...new Set(edges.map(({ candidate }) => candidate.driverId))].sort(compareId);
  const rideIds = [...new Set(edges.map(({ candidate }) => candidate.rideId))].sort(compareId);
  const sink = driverIds.length + rideIds.length + 1;
  const graph = Array.from({ length: sink + 1 }, () => []);
  const driverNodes = new Map(driverIds.map((id, i) => [id, i + 1]));
  const rideNodes = new Map(rideIds.map((id, i) => [id, driverIds.length + i + 1]));
  const addEdge = (from, to, cost) => {
    const forward = { to, cost, capacity: 1, reverse: graph[to].length };
    const reverse = { to: from, cost: -cost, capacity: 0, reverse: graph[from].length };
    graph[from].push(forward); graph[to].push(reverse); return forward;
  };
  for (const id of driverIds) addEdge(0, driverNodes.get(id), 0);
  const links = edges.map((edge) => ({ edge,
    link: addEdge(driverNodes.get(edge.candidate.driverId), rideNodes.get(edge.candidate.rideId), edge.cost) }));
  for (const id of rideIds) addEdge(rideNodes.get(id), sink, 0);

  // Successive shortest augmenting paths: continue even at positive cost, so
  // cardinality comes first. Residual reverse edges allow earlier pairs to move.
  // Bellman-Ford handles waiting credits and reverse edges without dependencies.
  for (let flow = 0; flow < Math.min(driverIds.length, rideIds.length); flow += 1) {
    const distances = Array(graph.length).fill(Infinity), previous = Array(graph.length).fill(null);
    distances[0] = 0;
    for (let pass = 0; pass < graph.length - 1; pass += 1) {
      let changed = false;
      for (let from = 0; from < graph.length; from += 1) {
        if (!Number.isFinite(distances[from])) continue;
        for (let i = 0; i < graph[from].length; i += 1) {
          const link = graph[from][i];
          if (link.capacity === 0 || distances[from] + link.cost >= distances[link.to]) continue;
          distances[link.to] = distances[from] + link.cost;
          previous[link.to] = { from, index: i }; changed = true;
        }
      }
      if (!changed) break;
    }
    if (previous[sink] === null) break;
    for (let node = sink; node !== 0;) {
      const { from, index } = previous[node], link = graph[from][index];
      link.capacity -= 1; graph[node][link.reverse].capacity += 1; node = from;
    }
  }
  return links.filter(({ link }) => link.capacity === 0).map(({ edge }) => edge);
}

function validateInput(candidates, now) {
  if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - DISPATCH_POLICY.offerTtlMs) {
    throw new TypeError('A valid server time is required.');
  }
  if (!Array.isArray(candidates)) throw new TypeError('Dispatch candidates must be an array.');
}

/**
 * Bound the road-routing input without blindly slicing away viable pairings.
 * Retains at most 32 oldest eligible rides, 32 drivers and 512 candidate edges;
 * the edge budget preserves maximum match cardinality within those node sets.
 * This helper bounds downstream routing/optimization, not candidate discovery.
 * Eligibility filtering (including previous offers) belongs before this call.
 */
export function boundedDispatchCandidates(candidates, now) {
  validateInput(candidates, now);
  return boundedEdges(candidates, now).map(({ candidate }) => candidate);
}

/**
 * Allocate already-eligible candidate edges, without mutation or I/O. The caller
 * checks approval, category, capacity, GPS freshness, active offers and workload,
 * then atomically revalidates before persisting these proposed offers. Accepting
 * an offer does not accept a fare or confirm a booking.
 *
 * Sequential mode greedily takes the best remaining edge. Opt-in batch mode
 * maximizes matching cardinality, then minimizes summed pickup/waiting cost on
 * the bounded graph. Waiting credits improve priority; availability, graph caps
 * and expiring requests mean this cannot guarantee that every rider is served.
 */
export function allocateDispatchOffers(candidates, now, { mode = 'sequential', costForCandidate = null } = {}) {
  validateInput(candidates, now);
  if (!['sequential', 'batch'].includes(mode)) throw new TypeError('Unknown dispatch mode.');
  if (costForCandidate !== null && typeof costForCandidate !== 'function') throw new TypeError('Dispatch candidate cost must be a function.');
  const edges = boundedEdges(candidates, now, costForCandidate);
  const chosen = mode === 'batch' ? batchAllocation(edges) : greedyAllocation(edges);
  return chosen.sort(compareEdges).map(({ candidate, etaSource, reasons }) => ({ ...candidate,
    offerExpiresAt: Math.min(now + DISPATCH_POLICY.offerTtlMs, candidate.expiresAt),
    dispatch: { policyVersion: DISPATCH_POLICY.version, mode,
      algorithm: mode === 'batch' ? 'min_cost_max_flow' : 'greedy', etaSource, reasons },
  }));
}
