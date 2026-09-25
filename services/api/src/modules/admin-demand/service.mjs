import { demandFilters, demandMetrics, demandDaily, demandHours, demandRegion, coverageFilters, coverageSummary, coverageCell, COVERAGE_MAX_CELLS } from './domain.mjs';

/** Bounded aggregate reporting; every read checks current staff permission. */
export function createAdminDemandService({ repository, requirePermission, clock, unitOfWork, allowSimulation = false }) {
  return Object.freeze({
    async coverage(user, query = {}) {
      return unitOfWork(async () => {
        await requirePermission(user.id, 'demand.read');
        const now = clock(), filter = coverageFilters(query, now);
        const rows = await repository.coverage(filter, now, allowSimulation);
        const mapped = rows.filter(row => row.mapKind === 'mapped');
        const totals = coverageSummary(mapped);
        const sample = coverageSummary(rows.filter(row => row.mapKind === 'sample'));
        const unlocated = coverageSummary(rows.filter(row => row.mapKind === 'unlocated'));
        const place = filter.place ? Object.fromEntries(['id', 'name', 'stateId', 'kind', 'sourceId'].map(key => [key, filter.place[key]])) : null;
        return { viewerId: user.id, asOf: now, timezone: 'Africa/Lagos',
          filters: { from: filter.from, to: filter.to, service: filter.service, place: place?.id ?? '', bbox: filter.bbox, layer: filter.layer },
          cohort: { from: filter.since, until: filter.until, basis: 'request_created_at', outcomeAsOf: now },
          viewport: { bounds: filter.bounds, cellDegrees: filter.cellDegrees, place, approximate: true, maxCells: COVERAGE_MAX_CELLS, truncated: false },
          historicalTotals: totals.historical, currentTotals: totals.current,
          cells: mapped.map(row => coverageCell(row, filter)),
          offMap: { scope: 'nationwide', historical: { sample: sample.historical, unlocated: unlocated.historical },
            current: { sample: sample.current, unlocated: unlocated.current } },
          outsideViewport: coverageSummary(rows.filter(row => row.mapKind === 'outside')),
          nationwideTotals: coverageSummary(rows),
        };
      });
    },
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
