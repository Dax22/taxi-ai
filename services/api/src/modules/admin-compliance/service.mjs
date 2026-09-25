import { check } from '../../shared/errors.mjs';
import { actionData, canonical, documents, filters, identifier, summary } from './domain.mjs';

/** Compliance work never edits application approval or delivers external notifications. */
export function createAdminComplianceService({ repository, getEligibility, requirePermission, unitOfWork, tokens, audit, clock }) {
  async function canManage(userId) {
    try { await requirePermission(userId, 'compliance.manage'); return true; }
    catch (error) { if (error.code === 'FORBIDDEN') return false; throw error; }
  }
  async function current(id) {
    const row = await repository.get(id);
    check(row, 'NOT_FOUND', 'Active driver Work profile not found.');
    return row;
  }
  async function projection(row, now, manage) {
    const docs = documents(await repository.documents(row.id), now);
    return { driver: summary(row, await getEligibility(row.id), docs, now, manage), documents: docs };
  }
  async function detail(userId, row, filter, now, manage) {
    const history = await repository.events(row.id, filter), events = history.slice(0, filter.limit), last = events.at(-1);
    return { viewerId: userId, serverNow: now, followUpMode: 'internal', ...(await projection(row, now, manage)),
      review: await repository.review(row.id), applicationHistory: await repository.applicationHistory(row.id),
      events: events.map(({ actorId, actorName, ...event }) => ({ ...event, actor: { id: actorId, name: actorName } })),
      page: { next: history.length > filter.limit ? `${last.createdAt}.${last.id}` : null, limit: filter.limit } };
  }
  async function list(userId, query = {}) {
    const filter = filters(query);
    return unitOfWork(async () => {
      await requirePermission(userId, 'compliance.read');
      const now = clock(), manage = await canManage(userId), rows = await repository.list(filter, now), selected = rows.slice(0, filter.limit);
      const drivers = [];
      for (const row of selected) drivers.push((await projection(row, now, manage)).driver);
      return { viewerId: userId, serverNow: now, followUpMode: 'internal', summary: await repository.counts(filter, now), drivers,
        page: { next: rows.length > filter.limit ? selected.at(-1).id : null, limit: filter.limit },
        filters: { queue: filter.queue, followUp: filter.followUp, q: filter.q } };
    });
  }
  async function get(userId, id, query = {}) {
    identifier(id); const filter = filters(query, true);
    return unitOfWork(async () => {
      await requirePermission(userId, 'compliance.read');
      const row = await current(id), now = clock();
      await audit.record(userId, 'admin.compliance.view', id, now);
      return detail(userId, row, filter, now, await canManage(userId));
    });
  }
  async function command({ userId, id, action, data, key }) {
    identifier(id);
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique command key is required.');
    const fingerprint = tokens.digest(canonical({ id, action, data }));
    return unitOfWork(async () => {
      await requirePermission(userId, 'compliance.read');
      await requirePermission(userId, 'compliance.manage');
      const row = await current(id), now = clock(), previous = await repository.command(userId, key);
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another action.');
        return { ...(await detail(userId, row, filters({}, true), now, true)), replayed: true };
      }
      const input = actionData(action, data, now), expected = row.followupVersion ?? 0;
      check(expected === input.expectedVersion, 'STALE_VERSION', 'This follow-up changed. Refresh before acting on it.');
      if (action === 'complete') check(row.followupStatus === 'open', 'INVALID_INPUT', 'Only an open follow-up can be completed.');
      const saved = { id, action, note: input.note, dueAt: action === 'follow-up' ? input.dueAt : row.dueAt,
        status: action === 'follow-up' ? 'open' : 'done', version: expected + 1, actorId: userId, now,
        applicationVersion: action === 'follow-up' ? row.applicationVersion : row.followupApplicationVersion,
        completedAt: action === 'complete' ? now : null };
      check(await repository.save(saved, expected) === 1, 'STALE_VERSION', 'This follow-up changed. Refresh before acting on it.');
      await repository.event({ ...saved, eventId: tokens.id() });
      await repository.saveCommand(userId, key, fingerprint, id, now);
      await audit.record(userId, `admin.compliance.${action}`, id, now);
      return { ...(await detail(userId, await current(id), filters({}, true), now, true)), replayed: false };
    });
  }
  return Object.freeze({ list, get, command });
}
