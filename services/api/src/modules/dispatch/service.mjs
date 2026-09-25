import { allocateDispatchOffers, boundedDispatchCandidates, DISPATCH_POLICY } from '../../../../../packages/shared/src/dispatch.mjs';
import { distanceMeters } from '../../../../../packages/shared/src/locations.mjs';
import { check } from '../../shared/errors.mjs';
import { requireRole, requireEligibleDriver } from '../../shared/policies.mjs';
import { fields } from '../../shared/validation.mjs';

/** Bounded invitations. Routing happens outside transactions; leases fence writes after routing. */
export function createDispatchService({ repository, candidates, candidateFor, getAccount, estimateMany,
  unitOfWork, tokens, audit, clock, onOffer = () => {}, config, coordinator = null }) {
  const mode = config.mode;
  check(['legacy', 'sequential', 'batch'].includes(mode), 'INVALID_DISPATCH_CONFIG', 'Choose a valid matching policy.');
  const batchWindowMs = config.batchWindowMs ?? 2000;
  check(Number.isInteger(batchWindowMs) && batchWindowMs >= 0 && batchWindowMs <= 5000,
    'INVALID_DISPATCH_CONFIG', 'The batch window must be between zero and five seconds.');
  const running = new Map();
  let stopped = false;
  const enabled = mode !== 'legacy';
  const valid = async (offer, now) => offer?.status === 'pending' && now < offer.expiresAt
    && (await candidateFor(offer.rideId, offer.driverId, now))?.availabilityId === offer.availabilityId;
  async function close(offer, status, now) {
    if (await repository.close(offer.id, status, now)) await audit.record(offer.driverId, `dispatch.${status}`, offer.id, now);
  }
  async function sweepInside(now, region = null) {
    for (const offer of await repository.pending(region)) {
      if (now >= offer.expiresAt) await close(offer, 'expired', now);
      else if (!await valid(offer, now)) await close(offer, 'revoked', now);
    }
  }
  async function sweep(region = null) {
    if (enabled && !stopped) await unitOfWork(() => sweepInside(clock(), region));
  }
  async function run(region, suppliedLease) {
    if (suppliedLease && suppliedLease.name !== `dispatch:${region}`) throw new Error('A dispatch lease belongs to a different region.');
    const lease = suppliedLease ?? (coordinator ? await coordinator.acquire(`dispatch:${region}`) : null);
    if (coordinator && !lease) return;
    try {
      await sweep(region);
      const now = clock(), pending = await repository.pending(region);
      const busyDrivers = new Set(pending.map((o) => o.driverId)), busyRides = new Set(pending.map((o) => o.rideId));
      const candidatesNow = await candidates(now, { region, excludeDriverIds: busyDrivers, excludeRideIds: busyRides,
        attempted: repository.attempted, minimumAgeMs: mode === 'batch' ? batchWindowMs : 0 });
      const edges = [];
      for (const edge of candidatesNow) {
        if (!busyDrivers.has(edge.driverId) && !busyRides.has(edge.rideId)
          && !await repository.attempted(edge.rideId, edge.driverId)
          && (mode !== 'batch' || now >= edge.createdAt + batchWindowMs)) edges.push(edge);
      }
      edges.sort((a,b) => a.createdAt-b.createdAt || a.distanceMeters-b.distanceMeters
        || a.rideId.localeCompare(b.rideId) || a.driverId.localeCompare(b.driverId));
      const bounded = boundedDispatchCandidates(edges, now);
      if (!bounded.length || stopped) return;
      const roadEdges = bounded.filter((edge) => edge.from && edge.to);
      let estimates = [];
      try { estimates = await estimateMany(roadEdges.map(({ from, to }) => ({ from, to }))); } catch { /* Explicit fallback below. */ }
      if (stopped) return;
      const withEstimates = new Map(roadEdges.map((edge,i) => [edge, estimates[i]]));
      await unitOfWork(async () => {
        // A resumed, expired worker must not publish stale offers. The guard locks
        // this lease row until commit, so a new holder cannot overtake these writes.
        if (coordinator && !await coordinator.guard(lease)) return;
        const commitNow = clock(); await sweepInside(commitNow, region);
        const current = await repository.pending(region), driverIds = new Set(current.map((o) => o.driverId)), rideIds = new Set(current.map((o) => o.rideId));
        const eligible = [];
        for (const edge of bounded) {
          if (driverIds.has(edge.driverId) || rideIds.has(edge.rideId) || await repository.attempted(edge.rideId,edge.driverId)) continue;
          const live = await candidateFor(edge.rideId, edge.driverId, commitNow);
          if (!live || live.availabilityId !== edge.availabilityId || live.version !== edge.version
            || (region !== null && live.region !== region)) continue;
          if (edge.from && (!live.from || distanceMeters(edge.from, live.from) > 100)) continue;
          const estimate = withEstimates.get(edge);
          const road = estimate?.source === 'road' && Number.isFinite(estimate.durationSeconds) && estimate.durationSeconds >= 0
            && estimate.durationSeconds <= 7200 && Number.isSafeInteger(estimate.estimatedAt)
            && estimate.estimatedAt <= commitNow && commitNow - estimate.estimatedAt < 30_000;
          eligible.push({ ...live, pickupEtaSeconds: road ? estimate.durationSeconds : null, estimatedAt: road ? estimate.estimatedAt : null });
        }
        for (const edge of allocateDispatchOffers(eligible, commitNow, { mode })) {
          const offer = { id: tokens.id(), rideId: edge.rideId, driverId: edge.driverId, availabilityId: edge.availabilityId,
            mode, policyVersion: edge.dispatch.policyVersion, etaSource: edge.dispatch.etaSource,
            pickupEtaSeconds: edge.pickupEtaSeconds, estimatedAt: edge.estimatedAt, createdAt: commitNow, expiresAt: edge.offerExpiresAt };
          // Global ride/driver unique pending indexes arbitrate drivers visible in
          // neighbouring geographic partitions without creating double offers.
          if (await repository.insert(offer)) {
            await audit.record(offer.driverId, 'dispatch.offered', offer.id, commitNow);
            await onOffer(offer);
          }
        }
      });
    } finally { if (coordinator && lease && !suppliedLease) await coordinator.release(lease); }
  }
  function refresh({ region = null, lease = null } = {}) {
    if (!enabled || stopped || (region === null && config.requestRefresh === false)) return Promise.resolve();
    const key = region ?? '*';
    if (!running.has(key)) {
      const job = (async () => {
        if (region !== null) return run(region, lease);
        if (coordinator && repository.activeRegions) {
          for (const id of await repository.activeRegions(clock())) await refresh({ region: id });
        } else await run(null, null);
      })().finally(() => running.delete(key));
      running.set(key, job);
    }
    return running.get(key);
  }
  async function forDriver(driverId, now) {
    if (!enabled) return null;
    const offer = await repository.forDriver(driverId);
    return await valid(offer, now) ? offer : null;
  }
  async function accept(user, rideId, offerId, now) {
    if (!enabled) return;
    const offer = typeof offerId === 'string' ? await repository.find(offerId) : null;
    check(offer?.driverId === user.id && offer.rideId === rideId && await valid(offer, now),
      'OFFER_UNAVAILABLE', 'This ride offer has ended. Refresh to see your next offer.');
    check(await repository.close(offer.id, 'accepted', now), 'OFFER_UNAVAILABLE', 'This ride offer has ended.');
    await audit.record(user.id, 'dispatch.accepted', offer.id, now);
  }
  async function decline({ userId, offerId, key, data }) {
    const user = await getAccount(userId); requireEligibleDriver(user); fields(data, []);
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const fingerprint = tokens.digest(JSON.stringify(['decline', offerId]));
    return unitOfWork(async () => {
      const previous = await repository.command(userId, key);
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another action.');
        return { declined: true, replayed: true };
      }
      const offer = await repository.find(offerId), now = clock();
      check(offer?.driverId === userId, 'NOT_FOUND', 'Ride offer not found.');
      check(enabled && await valid(offer, now), 'OFFER_UNAVAILABLE', 'This ride offer has ended. Refresh to continue.');
      await close(offer, 'declined', now);
      await repository.saveCommand(userId, key, fingerprint, offerId);
      return { declined: true, replayed: false };
    });
  }
  async function metrics(user) {
    requireRole(user, 'admin');
    const since = Math.max(0, clock() - 30 * 24 * 60 * 60_000);
    return { mode, since, offerTtlMs: DISPATCH_POLICY.offerTtlMs, ...await repository.metrics(since) };
  }
  return Object.freeze({ mode, enabled, refresh, sweep, forDriver, accept, decline, metrics,
    regions: () => repository.activeRegions(clock()),
    observe: (event) => repository.observe({ ...event, mode }),
    stop: async () => { stopped = true; await Promise.allSettled([...running.values()]); } });
}
