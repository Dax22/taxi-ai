import { allocateDispatchOffers, boundedDispatchCandidates, DISPATCH_POLICY } from '../../../../../packages/shared/src/dispatch.mjs';
import { distanceMeters } from '../../../../../packages/shared/src/locations.mjs';
import { check } from '../../shared/errors.mjs';
import { requireRole, requireEligibleDriver } from '../../shared/policies.mjs';
import { fields } from '../../shared/validation.mjs';

/** Persistent, bounded invitations. Network work never runs inside unitOfWork. */
export function createDispatchService({ repository, candidates, candidateFor, getAccount, estimateMany,
  unitOfWork, tokens, audit, clock, onOffer = () => {}, config }) {
  const mode = config.mode;
  check(['legacy', 'sequential', 'batch'].includes(mode), 'INVALID_DISPATCH_CONFIG', 'Choose a valid matching policy.');
  const batchWindowMs = config.batchWindowMs ?? 2000;
  check(Number.isInteger(batchWindowMs) && batchWindowMs >= 0 && batchWindowMs <= 5000,
    'INVALID_DISPATCH_CONFIG', 'The batch window must be between zero and five seconds.');
  let running = null, stopped = false;
  const enabled = mode !== 'legacy';
  const valid = (offer, now) => offer?.status === 'pending' && now < offer.expiresAt
    && candidateFor(offer.rideId, offer.driverId, now)?.availabilityId === offer.availabilityId;
  function close(offer, status, now) {
    if (repository.close(offer.id, status, now)) audit.record(offer.driverId, `dispatch.${status}`, offer.id, now);
  }
  function sweepInside(now) {
    for (const offer of repository.pending()) {
      if (now >= offer.expiresAt) close(offer, 'expired', now);
      else if (!valid(offer, now)) close(offer, 'revoked', now);
    }
  }
  function sweep() { if (enabled && !stopped) unitOfWork(() => sweepInside(clock())); }
  async function run() {
    sweep();
    const now = clock(), pending = repository.pending();
    const busyDrivers = new Set(pending.map((o) => o.driverId)), busyRides = new Set(pending.map((o) => o.rideId));
    const edges = candidates(now, { excludeDriverIds: busyDrivers, excludeRideIds: busyRides,
      attempted: repository.attempted, minimumAgeMs: mode === 'batch' ? batchWindowMs : 0 })
      .filter((edge) => !busyDrivers.has(edge.driverId) && !busyRides.has(edge.rideId)
      && !repository.attempted(edge.rideId, edge.driverId)
      && (mode !== 'batch' || now >= edge.createdAt + batchWindowMs));
    // Prioritize oldest requests, then nearby drivers before spending the routing budget.
    edges.sort((a,b) => a.createdAt-b.createdAt || a.distanceMeters-b.distanceMeters
      || a.rideId.localeCompare(b.rideId) || a.driverId.localeCompare(b.driverId));
    const bounded = boundedDispatchCandidates(edges, now);
    if (!bounded.length || stopped) return;
    const roadEdges = bounded.filter((edge) => edge.from && edge.to);
    let estimates = [];
    try { estimates = await estimateMany(roadEdges.map(({ from, to }) => ({ from, to }))); } catch { /* Explicit fallback below. */ }
    if (stopped) return;
    const withEstimates = new Map(roadEdges.map((edge,i) => [edge, estimates[i]]));
    unitOfWork(() => {
      const commitNow = clock(); sweepInside(commitNow);
      const current = repository.pending(), driverIds = new Set(current.map((o) => o.driverId)), rideIds = new Set(current.map((o) => o.rideId));
      const eligible = bounded.flatMap((edge) => {
        if (driverIds.has(edge.driverId) || rideIds.has(edge.rideId) || repository.attempted(edge.rideId,edge.driverId)) return [];
        const live = candidateFor(edge.rideId, edge.driverId, commitNow);
        if (!live || live.availabilityId !== edge.availabilityId || live.version !== edge.version) return [];
        // An async result cannot create an offer using a driver who moved away while routing.
        if (edge.from && (!live.from || distanceMeters(edge.from, live.from) > 100)) return [];
        const estimate = withEstimates.get(edge);
        const road = estimate?.source === 'road' && Number.isFinite(estimate.durationSeconds) && estimate.durationSeconds >= 0
          && estimate.durationSeconds <= 7200 && Number.isSafeInteger(estimate.estimatedAt)
          && estimate.estimatedAt <= commitNow && commitNow - estimate.estimatedAt < 30_000;
        return [{ ...live, pickupEtaSeconds: road ? estimate.durationSeconds : null, estimatedAt: road ? estimate.estimatedAt : null }];
      });
      for (const edge of allocateDispatchOffers(eligible, commitNow, { mode })) {
        const offer = { id: tokens.id(), rideId: edge.rideId, driverId: edge.driverId, availabilityId: edge.availabilityId,
          mode, policyVersion: edge.dispatch.policyVersion, etaSource: edge.dispatch.etaSource,
          pickupEtaSeconds: edge.pickupEtaSeconds, estimatedAt: edge.estimatedAt, createdAt: commitNow, expiresAt: edge.offerExpiresAt };
        if (repository.insert(offer)) {
          audit.record(offer.driverId, 'dispatch.offered', offer.id, commitNow);
          onOffer(offer);
        }
      }
    });
  }
  function refresh() {
    if (!enabled || stopped) return Promise.resolve();
    if (!running) running = run().finally(() => { running = null; });
    return running;
  }
  function forDriver(driverId, now) {
    if (!enabled) return null;
    const offer = repository.forDriver(driverId);
    return valid(offer, now) ? offer : null;
  }
  function accept(user, rideId, offerId, now) {
    if (!enabled) return;
    const offer = typeof offerId === 'string' ? repository.find(offerId) : null;
    check(offer?.driverId === user.id && offer.rideId === rideId && valid(offer, now),
      'OFFER_UNAVAILABLE', 'This ride offer has ended. Refresh to see your next offer.');
    check(repository.close(offer.id, 'accepted', now), 'OFFER_UNAVAILABLE', 'This ride offer has ended.');
    audit.record(user.id, 'dispatch.accepted', offer.id, now);
  }
  function decline({ userId, offerId, key, data }) {
    const user = getAccount(userId); requireEligibleDriver(user); fields(data, []);
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const fingerprint = tokens.digest(JSON.stringify(['decline', offerId]));
    sweep();
    return unitOfWork(() => {
      const previous = repository.command(userId, key);
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another action.');
        return { declined: true, replayed: true };
      }
      const offer = repository.find(offerId), now = clock();
      check(offer?.driverId === userId, 'NOT_FOUND', 'Ride offer not found.');
      check(enabled && valid(offer, now), 'OFFER_UNAVAILABLE', 'This ride offer has ended. Refresh to continue.');
      close(offer, 'declined', now);
      repository.saveCommand(userId, key, fingerprint, offerId);
      return { declined: true, replayed: false };
    });
  }
  function metrics(user) {
    requireRole(user, 'admin');
    const since = Math.max(0, clock() - 30 * 24 * 60 * 60_000);
    return { mode, since, offerTtlMs: DISPATCH_POLICY.offerTtlMs, ...repository.metrics(since) };
  }
  return Object.freeze({ mode, enabled, refresh, sweep, forDriver, accept, decline, metrics,
    observe: (event) => repository.observe({ ...event, mode }),
    stop: async () => { stopped = true; await running; } });
}
