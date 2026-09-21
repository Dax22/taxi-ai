import { EXPANDED_RADIUS_METERS, REQUEST_MS } from './matching.mjs';

/** A transparent preview policy, not a trained model or an autonomous dispatcher. */
export const MATCH_RANKING_POLICY = Object.freeze({ version: 'proximity-wait-v1',
  proximityWeight: 0.75, waitingWeight: 0.25, distanceScaleMeters: EXPANDED_RADIUS_METERS,
  waitingScaleMs: REQUEST_MS, nearbyMeters: 2000, waitingReasonMs: 60_000 });
export const MATCH_REASON_LABELS = Object.freeze({
  nearby_pickup: 'Pickup within 2 km in a straight line',
  within_search_area: 'Pickup within your current search area',
  sample_area: 'Matches your selected sample area',
  waiting_longer: 'Customer has waited at least a minute',
});

/**
 * Rank already-eligible requests. Approval, workload, category, capacity, GPS
 * freshness and radius are enforced by the caller and checked again on claim.
 * Scores stay internal: publishing them would reveal precise pickup distance.
 */
export function rankEligibleMatches(candidates, now) {
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('A valid server time is required.');
  const p = MATCH_RANKING_POLICY;
  return candidates.filter((c) => typeof c.id === 'string' && c.id.length > 0
    && Number.isSafeInteger(c.createdAt) && c.createdAt >= 0 && c.createdAt <= now
    && Number.isSafeInteger(c.expiresAt) && c.expiresAt > now
    && (c.distanceMeters === null || Number.isFinite(c.distanceMeters) && c.distanceMeters >= 0 && c.distanceMeters <= p.distanceScaleMeters))
    .map((candidate) => {
      const age = now - candidate.createdAt;
      const proximity = candidate.distanceMeters === null ? 0 : 1 - candidate.distanceMeters / p.distanceScaleMeters;
      const score = p.proximityWeight * proximity + p.waitingWeight * Math.min(1, age / p.waitingScaleMs);
      const reasons = [candidate.distanceMeters === null ? 'sample_area'
        : candidate.distanceMeters <= p.nearbyMeters ? 'nearby_pickup' : 'within_search_area'];
      if (age >= p.waitingReasonMs) reasons.push('waiting_longer');
      return { candidate, score, reasons };
    })
    .sort((a, b) => b.score - a.score || a.candidate.createdAt - b.candidate.createdAt
      || (a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0))
    .map(({ candidate, reasons }, index) => ({ ...candidate,
      recommendation: { policyVersion: p.version, rank: index + 1, reasons } }));
}

export function validMatchRecommendation(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && value.policyVersion === MATCH_RANKING_POLICY.version && Number.isSafeInteger(value.rank) && value.rank > 0
    && value.rank <= 50 && Array.isArray(value.reasons) && value.reasons.length >= 1 && value.reasons.length <= 2
    && ['nearby_pickup', 'within_search_area', 'sample_area'].includes(value.reasons[0])
    && (value.reasons.length === 1 || value.reasons[1] === 'waiting_longer');
}
