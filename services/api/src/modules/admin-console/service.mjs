import { requireRole } from '../../shared/policies.mjs';
import { check } from '../../shared/errors.mjs';
import { filters, recordId, page, accountSummary, tripSummary, summarize } from './domain.mjs';

/** Staff-only reporting. No booking, approval, payment or account mutations. */
export function createAdminConsoleService({ repository, audit, clock, unitOfWork }) {
  function withStaff(user, read) { requireRole(user, 'admin'); return unitOfWork(() => ({ ...read(clock()), viewerId: user.id, paymentMode: 'simulation' })); }
  return Object.freeze({
    accounts: (user, query) => withStaff(user, (now) => {
      const filter = filters(query, now, 'accounts'), result = page(repository.accounts(filter), filter);
      return { ...result, items: result.items.map((row) => accountSummary(row)), counts: repository.accountCounts(0, now + 1) };
    }),
    account: (user, id, query) => withStaff(user, (now) => {
      const record = repository.account(recordId(id)); check(record, 'NOT_FOUND', 'Account not found.');
      const filter = filters(query, now, 'trips'), result = page(repository.trips(filter, now, id), filter);
      const lifetime = summarize(repository.facts(filters({}, now, 'trips'), now, id), null, id);
      audit.record(user.id, 'admin.account_viewed', id, now);
      return { account: accountSummary(record, true), ...lifetime, trips: { ...result, items: result.items.map(tripSummary) }, range: filter.range };
    }),
    trips: (user, query) => withStaff(user, (now) => {
      const filter = filters(query, now, 'trips'); check(filter.mode === 'all', 'INVALID_INPUT', 'Participant mode applies only to an account.');
      const result = page(repository.trips(filter, now), filter);
      return { ...result, items: result.items.map(tripSummary), range: filter.range };
    }),
    trip: (user, id) => withStaff(user, (now) => {
      const row = repository.trip(recordId(id), now); check(row, 'NOT_FOUND', 'Trip not found.');
      const snapshot = row.driverSnapshotJson ? JSON.parse(row.driverSnapshotJson) : null;
      const vehicle = snapshot?.vehicle ? Object.fromEntries(['model', 'plate', 'make', 'modelName', 'year', 'colour']
        .filter((key) => snapshot.vehicle[key] !== undefined).map((key) => [key, snapshot.vehicle[key]])) : null;
      audit.record(user.id, 'admin.trip_viewed', id, now);
      return { trip: { ...tripSummary(row), vehicle, matchedAt: row.matchedAt, bookedAt: row.bookedAt,
        paidAt: row.paidAt, paymentReference: row.paymentReference }, activity: repository.activity(id) };
    }),
    analytics: (user, query) => withStaff(user, (now) => {
      const filter = filters(query, now, 'analytics');
      return { ...summarize(repository.facts(filter, now), filter.range), range: filter.range,
        recentTrips: repository.trips({ ...filter, limit: 4 }, now).slice(0, 4).map(tripSummary),
        accounts: repository.accountCounts(filter.range.start, filter.range.end), routes: repository.routes(filter, now).map((row) => {
          const names = tripSummary(row); return { pickup: names.pickup, destination: names.destination, requests: row.requests, completed: row.completed };
        }) };
    }),
  });
}
