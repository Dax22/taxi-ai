import { demandFilters, demandMetrics, demandDaily, demandHours, demandRegion } from './domain.mjs';

/** Bounded aggregate reporting; every read checks current staff permission. */
export function createAdminDemandService({ repository, requirePermission, clock, unitOfWork, allowSimulation = false }) {
  return Object.freeze({
    async get(user, query = {}) {
      return unitOfWork(async () => {
        await requirePermission(user.id, 'demand.read');
        const now = clock(), filter = demandFilters(query, now);
        const totals = demandMetrics(await repository.totals(filter, now));
        const daily = demandDaily(await repository.daily(filter, now), filter);
        const hours = demandHours(await repository.hours(filter, now));
        const offers = Object.fromEntries(Object.entries(await repository.offers(filter, now)).map(([key, value]) => [key, Number(value)]));
        offers.resolvedForAcceptance = offers.accepted + offers.declined + offers.expired;
        offers.acceptanceRate = offers.resolvedForAcceptance ? offers.accepted / offers.resolvedForAcceptance : null;
        const supply = await repository.currentSupply(filter, now, allowSimulation);
        const rows = await repository.areas(filter, now, allowSimulation);
        return { viewerId: user.id, asOf: now, timezone: 'Africa/Lagos',
          filters: { from: filter.from, to: filter.to, service: filter.service, region: filter.region, limit: filter.limit },
          cohort: { from: filter.since, until: filter.until, unit: 'requests', basis: 'request_created_at', outcomeAsOf: now },
          totals, offers, daily, hours,
          supply: { capturedAt: now, availableDrivers: Number(supply.availableDrivers), scope: 'current', serviceFilterApplied: true },
          areas: { items: rows.slice(0, filter.limit).map((row) => ({ region: demandRegion(row.regionKey), ...demandMetrics(row),
            availableDrivers: Number(row.availableDrivers) })), limit: filter.limit, truncated: rows.length > filter.limit },
        };
      });
    },
  });
}
