import { allocateDispatchOffers, boundedDispatchCandidates, DISPATCH_POLICY } from '../../../../../packages/shared/src/dispatch.mjs';
import { distanceMeters } from '../../../../../packages/shared/src/locations.mjs';
import { check } from '../../shared/errors.mjs';
import { requireRole, requireEligibleDriver } from '../../shared/policies.mjs';
import { fields } from '../../shared/validation.mjs';
import { matchingPairKey } from '../../shared/matching-pair-key.mjs';

/** Bounded invitations. Routing happens outside transactions; leases fence writes after routing. */
export function createDispatchService({ repository, candidates, candidateFor, getAccount, estimateMany,
  unitOfWork, workerUnitOfWork = null, tokens, audit, clock, onOffer = () => {}, config, coordinator = null, profile = null,
  candidatesFor = null, attemptedMany = null, batchEnabledFor = () => false, ranker = null }) {
  const mode = config.mode;
  check(['legacy', 'sequential', 'batch'].includes(mode), 'INVALID_DISPATCH_CONFIG', 'Choose a valid matching policy.');
  const batchWindowMs = config.batchWindowMs ?? 2000;
  check(Number.isInteger(batchWindowMs) && batchWindowMs >= 0 && batchWindowMs <= 5000,
    'INVALID_DISPATCH_CONFIG', 'The batch window must be between zero and five seconds.');
  const running = new Map();
  const workerWork = (action, region) => workerUnitOfWork ? workerUnitOfWork(action, region) : unitOfWork(action);
  let stopped = false;
  const enabled = mode !== 'legacy';
  const valid = async (offer, now) => offer?.status === 'pending' && now < offer.expiresAt
    && (await candidateFor(offer.rideId, offer.driverId, now))?.availabilityId === offer.availabilityId;
  async function close(offer, status, now) {
    if (await repository.close(offer.id, status, now)) await audit.record(offer.driverId, `dispatch.${status}`, offer.id, now);
  }
  async function sweepInside(now, region = null) {
    const pending = await repository.pending(region);
    const live = candidatesFor && batchEnabledFor(region) ? await candidatesFor(pending.filter(offer => now < offer.expiresAt), now) : null;
    for (const offer of pending) {
      if (now >= offer.expiresAt) await close(offer, 'expired', now);
      else if (live ? live.get(matchingPairKey(offer.rideId, offer.driverId))?.availabilityId !== offer.availabilityId
        : !await valid(offer, now)) await close(offer, 'revoked', now);
    }
  }
  async function sweep(region = null) {
    if (enabled && !stopped) await workerWork(() => sweepInside(clock(), region), region);
  }
  const measure = (name, action) => profile ? profile.phase(name, action) : action();
  const run = (region, lease) => profile ? profile.cycle(() => runCycle(region, lease), { region }) : runCycle(region, lease);
  async function runCycle(region, suppliedLease) {
    if (suppliedLease && suppliedLease.name !== `dispatch:${region}`) throw new Error('A dispatch lease belongs to a different region.');
    const lease = suppliedLease ?? (coordinator ? await coordinator.acquire(`dispatch:${region}`) : null);
    if (coordinator && !lease) return;
    try {
      const bounded = await measure('discovery', async () => {
        await sweep(region);
        const now = clock(), pending = await repository.pending(region);
        const busyDrivers = new Set(pending.map((o) => o.driverId)), busyRides = new Set(pending.map((o) => o.rideId));
        const candidatesNow = await candidates(now, { region, excludeDriverIds: busyDrivers, excludeRideIds: busyRides,
          attempted: repository.attempted, minimumAgeMs: mode === 'batch' ? batchWindowMs : 0 });
        const tried = attemptedMany && batchEnabledFor(region) ? await attemptedMany(candidatesNow) : null;
        const edges = [];
        for (const edge of candidatesNow) {
          if (!busyDrivers.has(edge.driverId) && !busyRides.has(edge.rideId)
            && !(tried ? tried.has(matchingPairKey(edge.rideId, edge.driverId)) : await repository.attempted(edge.rideId, edge.driverId))
            && (mode !== 'batch' || now >= edge.createdAt + batchWindowMs)) edges.push(edge);
        }
        edges.sort((a,b) => a.createdAt-b.createdAt || a.distanceMeters-b.distanceMeters
          || a.rideId.localeCompare(b.rideId) || a.driverId.localeCompare(b.driverId));
        return boundedDispatchCandidates(edges, now);
      });
      if (!bounded.length || stopped) return;
      const roadEdges = bounded.filter((edge) => edge.from && edge.to);
      let estimates = [];
      try { estimates = await measure('routing', () => estimateMany(roadEdges.map(({ from, to }) => ({ from, to })))); } catch { /* Explicit fallback below. */ }
      if (stopped) return;
      const withEstimates = new Map(roadEdges.map((edge,i) => [edge, estimates[i]]));
      let rankingHistory = null;
      if (ranker?.enabled && region !== null) {
        try { rankingHistory = await measure('ml_features', () => ranker.prefetch(bounded, clock(), region)); }
        catch { rankingHistory = null; } // Ranking failure must never block deterministic dispatch.
      }
      const committed = await measure('commit', () => workerWork(async () => {
        // A resumed, expired worker must not publish stale offers. The guard locks
        // this lease row until commit, so a new holder cannot overtake these writes.
        if (coordinator && !await coordinator.guard(lease)) return;
        const commitNow = clock(); await sweepInside(commitNow, region);
        const current = await repository.pending(region), driverIds = new Set(current.map((o) => o.driverId)), rideIds = new Set(current.map((o) => o.rideId));
        const fast = candidatesFor && attemptedMany && batchEnabledFor(region);
        const tried = fast ? await attemptedMany(bounded) : null;
        const liveCandidates = fast ? await candidatesFor(bounded, commitNow) : null;
        const eligible = [];
        for (const edge of bounded) {
          if (driverIds.has(edge.driverId) || rideIds.has(edge.rideId)
            || (tried ? tried.has(matchingPairKey(edge.rideId, edge.driverId)) : await repository.attempted(edge.rideId,edge.driverId))) continue;
          const live = liveCandidates ? liveCandidates.get(matchingPairKey(edge.rideId, edge.driverId))
            : await candidateFor(edge.rideId, edge.driverId, commitNow);
          if (!live || live.availabilityId !== edge.availabilityId || live.version !== edge.version
            || (region !== null && live.region !== region)) continue;
          if (edge.from && (!live.from || distanceMeters(edge.from, live.from) > 100)) continue;
          const estimate = withEstimates.get(edge);
          const road = estimate?.source === 'road' && Number.isFinite(estimate.durationSeconds) && estimate.durationSeconds >= 0
            && estimate.durationSeconds <= 7200 && Number.isSafeInteger(estimate.estimatedAt)
            && estimate.estimatedAt <= commitNow && commitNow - estimate.estimatedAt < 30_000;
          eligible.push({ ...live, pickupEtaSeconds: road ? estimate.durationSeconds : null, estimatedAt: road ? estimate.estimatedAt : null });
        }
        const mlPlan = ranker?.plan(eligible, commitNow, region, rankingHistory) ?? null;
        const controlOffers = allocateDispatchOffers(eligible, commitNow, { mode });
        const modelOffers = mlPlan ? allocateDispatchOffers(eligible, commitNow, { mode, costForCandidate: mlPlan.costFor }) : controlOffers;
        const useModel = Boolean(mlPlan && ranker.liveFor(region));
        const chosen = useModel ? modelOffers.map(edge => ({ ...edge, dispatch: { ...edge.dispatch,
          policyVersion: `ml:${mlPlan.modelVersion}`, algorithm: 'ml_ranker' } })) : controlOffers;
        const inserted = [];
        for (const edge of chosen) {
          const offer = { id: tokens.id(), rideId: edge.rideId, driverId: edge.driverId, availabilityId: edge.availabilityId,
            mode, policyVersion: edge.dispatch.policyVersion, etaSource: edge.dispatch.etaSource,
            pickupEtaSeconds: edge.pickupEtaSeconds, estimatedAt: edge.estimatedAt, createdAt: commitNow, expiresAt: edge.offerExpiresAt };
          // Global ride/driver unique pending indexes arbitrate drivers visible in
          // neighbouring geographic partitions without creating double offers.
          if (await repository.insert(offer)) {
            inserted.push(offer);
            await audit.record(offer.driverId, 'dispatch.offered', offer.id, commitNow);
            await onOffer(offer);
          }
        }
        return mlPlan ? { mlPlan, eligible, controlOffers, modelOffers, inserted, commitNow } : null;
      }, region));
      // Shadow/training telemetry is intentionally best-effort and isolated from
      // the assignment transaction. A logging failure never rolls back an offer.
      if (committed?.mlPlan) {
        try { await workerWork(() => ranker.record(committed.mlPlan, committed.eligible, committed.controlOffers,
          committed.modelOffers, committed.inserted, committed.commitNow), region); } catch { /* deterministic/live offer already committed */ }
      }
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
    return { mode, since, offerTtlMs: DISPATCH_POLICY.offerTtlMs, ...await repository.metrics(since),
      mlRanking: ranker ? { enabled: ranker.enabled, mode: ranker.mode, modelVersion: ranker.version, cohorts: await ranker.metrics(since) } : { enabled: false, mode: 'off', modelVersion: null, cohorts: [] } };
  }
  return Object.freeze({ mode, enabled, refresh, sweep, forDriver, accept, decline, metrics,
    withdrawForUser: async (userId,now,scope='account') => {
      check(['customer','driver','vehicle','account'].includes(scope),'INVALID_INPUT','Invalid dispatch restriction scope.');
      for(const offer of await repository.pendingForUser(userId)) {
        const applies=scope==='account'||(scope==='customer'?offer.driverId!==userId:offer.driverId===userId);
        if(applies)await close(offer,'revoked',now);
      }
    },
    regions: () => repository.activeRegions(clock()),
    observe: (event) => repository.observe({ ...event, mode }),
    stop: async () => { stopped = true; await Promise.allSettled([...running.values()]); } });
}
