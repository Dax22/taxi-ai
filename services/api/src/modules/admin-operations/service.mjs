import { operationsFilters, operationPage, MATCHING_WINDOW_MS, DELAY_POLICY } from './domain.mjs';

/** Read-only operations. Permission is resolved afresh inside the read transaction. */
export function createAdminOperationsService({ repository, requirePermission, clock, unitOfWork, locationForTrip = async () => null, allowSimulation = false }) {
  return Object.freeze({
    async get(user, query = {}) {
      return unitOfWork(async () => {
        await requirePermission(user.id, 'operations.read');
        const filter = operationsFilters(query), now = clock(), since = now - MATCHING_WINDOW_MS;
        const counts = await repository.counts(now, allowSimulation, DELAY_POLICY);
        const rows = await repository.queue(filter, now, allowSimulation, DELAY_POLICY);
        const queue = operationPage(rows, filter, now);
        if (filter.queue === 'active') for (const row of queue.items) {
          const position = await locationForTrip(row.id);
          row.location = position ? { status: position.stale ? 'stale' : 'fresh', capturedAt: position.capturedAt }
            : { status: 'unavailable', capturedAt: null };
        }
        const matching = await repository.matching(since, now);
        return { viewerId: user.id, paymentMode: 'simulation', asOf: now, countScope: 'all_regions', counts,
          matching: { since, until: now, unit: 'offers', waitUnit: 'seconds', ...matching }, delayPolicy: DELAY_POLICY,
          filters: { queue: filter.queue, region: filter.region, status: filter.status, limit: filter.limit },
          queues: { [filter.queue]: queue } };
      });
    },
  });
}
