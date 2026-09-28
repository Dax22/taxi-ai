import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { CATEGORIES, PRIORITIES, STATUSES, RESPONSE_WINDOWS, identifier, choice, text, version, commandKey, canonical,
  filters, page, creation, permission, summary, tripEvidence, incidentEvidence } from './domain.mjs';

/** Case records authorise evidence reads; they do not grant passenger or emergency-dispatch powers. */
export function createAdminCasesService({ repository, requirePermission, listEligibleStaff, getTripEvidence, getIncidentEvidence,
  reviewIncident, unitOfWork, tokens, audit, clock }) {
  const envelope = (viewerId, value) => ({ viewerId, paymentMode: 'simulation', serverNow: clock(), ...value });
  async function access(userId, category) { await requirePermission(userId, permission(category)); }
  async function categoriesFor(userId) {
    const result = [];
    for (const category of CATEGORIES) {
      try { await access(userId, category); result.push(category); }
      catch (error) { if (error.code !== 'FORBIDDEN') throw error; }
    }
    check(result.length, 'FORBIDDEN', 'Your staff role cannot access cases.'); return result;
  }
  async function authorisedCase(userId, id) {
    identifier(id);
    const categories = await categoriesFor(userId), row = await repository.get(id);
    check(row && categories.includes(row.category), 'NOT_FOUND', 'Case not found.'); return row;
  }
  async function detail(userId, row, query = {}) {
    const result = page(await repository.events(row.id, filters(query, true)), filters(query, true));
    const eligibleStaff = (await listEligibleStaff(permission(row.category))).slice(0, 200).map(({ id, name }) => ({ id, name }));
    const trip = tripEvidence(await getTripEvidence(row.rideId, userId));
    const incident = row.incidentId ? incidentEvidence(await getIncidentEvidence(row.incidentId, userId)) : null;
    await access(userId, row.category);
    return envelope(userId, { case: { ...summary(row), description: row.description, trip, incident, capabilities: { canManage: true } },
      events: result.items.map(({ actorId, actorName, ...event }) => ({ ...event, actor: actorId ? { id: actorId, name: actorName ?? 'Staff member' } : null })),
      page: result.page, eligibleStaff });
  }
  async function list(userId, query = {}) {
    return await unitOfWork(async () => {
      const categories = await categoriesFor(userId), filter = filters(query);
      if (filter.category !== 'all') await access(userId, filter.category);
      const result = page(await repository.list(filter, categories, userId), filter);
      return envelope(userId, { cases: result.items.map(summary), page: result.page,
        permissions: { support: categories.includes('support'), safety: categories.includes('safety') } });
    });
  }
  async function get(userId, id, query = {}) {
    return await unitOfWork(async () => {
      const row = await authorisedCase(userId, id), value = await detail(userId, row, query);
      await audit.record(userId, 'admin.case.view', id, clock()); return value;
    });
  }
  async function event(row, actorId, action, note, now) {
    await repository.event({ id: tokens.id(), caseId: row.id, actorId, action, note, version: row.version, now });
    await audit.record(actorId, `admin.case.${action}`, row.id, now);
  }
  async function command({ userId, action, id = null, data, key }) {
    commandKey(key); const fingerprint = tokens.digest(canonical({ action, id, data }));
    return await unitOfWork(async () => {
      await categoriesFor(userId);
      const previous = await repository.command(userId, key);
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another case action.');
        return { ...await detail(userId, await authorisedCase(userId, previous.caseId)), replayed: true };
      }
      const now = clock(); let row;
      if (action === 'create') {
        const value = creation(data); await access(userId, value.category);
        check(await getTripEvidence(value.rideId, userId), 'NOT_FOUND', 'Trip not found.');
        const caseId = tokens.id();
        await repository.create({ ...value, id: caseId, now, responseDueAt: now + RESPONSE_WINDOWS[value.priority] });
        row = await repository.get(caseId); await event(row, userId, 'created', value.description, now);
      } else {
        row = await authorisedCase(userId, id);
        const allowed = { assign: ['expectedVersion', 'assigneeId', 'reason'], note: ['expectedVersion', 'body'], status: ['expectedVersion', 'status', 'reason'], priority: ['expectedVersion', 'priority', 'reason'] };
        check(Object.hasOwn(allowed, action), 'NOT_FOUND', 'Case action not found.'); fields(data, allowed[action]); version(row, data.expectedVersion);
        const next = { ...row, now }; let note, eventAction = action;
        if (action === 'note') note = text(data.body, 'Note');
        else note = text(data.reason, 'Reason', 5, 1000);
        if (action === 'assign') {
          if (data.assigneeId !== null) {
            identifier(data.assigneeId);
            check((await listEligibleStaff(permission(row.category))).some((staff) => staff.id === data.assigneeId), 'INVALID_INPUT', 'Choose an active staff member with access to this case category.');
          }
          check(row.assigneeId !== data.assigneeId, 'INVALID_INPUT', 'Choose a different assignment.'); next.assigneeId = data.assigneeId;
          eventAction = data.assigneeId ? 'assigned' : 'unassigned';
          // Record the actual target as well as the reason; later reassignment must not erase ownership history.
          note = `${data.assigneeId ?? 'Unassigned'}: ${note}`;
        } else if (action === 'status') {
          next.status = choice(data.status, STATUSES);
          check(next.status !== row.status, 'INVALID_INPUT', 'Choose a different case status.');
          if (row.status === 'resolved') {
            check(next.status === 'open', 'INVALID_INPUT', 'Reopen a resolved case before changing its workflow.');
            next.firstRespondedAt = null; next.responseDueAt = now + RESPONSE_WINDOWS[row.priority]; eventAction = 'reopened';
          } else {
            check(next.status !== 'open', 'INVALID_INPUT', 'Use in progress, waiting or resolved for an active case.');
            next.firstRespondedAt ??= now; eventAction = next.status;
          }
          next.resolvedAt = next.status === 'resolved' ? now : null;
          if (row.incidentId) await reviewIncident({ incidentId: row.incidentId, userId,
            status: next.status === 'resolved' ? 'resolved' : next.status === 'open' ? 'open' : 'acknowledged', reason: note, now });
        } else if (action === 'priority') {
          next.priority = choice(data.priority, PRIORITIES); check(next.priority !== row.priority, 'INVALID_INPUT', 'Choose a different priority.');
          // Triage cannot silently extend the existing response target; reopening explicitly creates a new target.
          if (!row.firstRespondedAt && row.status !== 'resolved') next.responseDueAt = Math.min(row.responseDueAt, now + RESPONSE_WINDOWS[next.priority]);
          note = `${row.priority} → ${next.priority}: ${note}`;
        }
        check(await repository.update(row.id, row.version, next), 'STALE_VERSION', 'This case changed. Refresh before acting on it.');
        row = await repository.get(row.id); await event(row, userId, eventAction, note, now);
      }
      await repository.saveCommand(userId, key, fingerprint, row.id, now);
      return { ...await detail(userId, row), replayed: false };
    });
  }
  // Called only by the trusted incident-creation hook inside its transaction, after the SOS has been saved.
  async function onIncident({ incidentId, rideId, now }) {
    identifier(incidentId); identifier(rideId);
    const existing = await repository.byIncident(incidentId); if (existing) return existing.id;
    const id = tokens.id();
    await repository.create({ id, rideId, incidentId, category: 'safety', subject: 'Trip safety incident',
      description: 'Saved SOS incident linked for staff review.', priority: 'urgent', now, responseDueAt: now + RESPONSE_WINDOWS.urgent });
    await repository.event({ id: tokens.id(), caseId: id, actorId: null, action: 'incident_linked', note: 'Saved SOS incident linked for staff review.', version: 0, now });
    return id;
  }
  // Legacy SOS review joins this hook in the same transaction. Do not call back into the safety service.
  async function syncIncident({ incidentId, status, userId, reason, now }) {
    const row = await repository.byIncident(incidentId); if (!row) return null;
    const nextStatus = { open: 'open', acknowledged: 'in_progress', resolved: 'resolved' }[status];
    check(nextStatus, 'INVALID_INPUT', 'Choose a supported incident state.');
    if (row.status === nextStatus || (row.status === 'waiting' && status === 'acknowledged')) return row.id;
    const reopening = row.status === 'resolved' && status !== 'resolved';
    const next = { ...row, now, status: nextStatus, resolvedAt: nextStatus === 'resolved' ? now : null,
      firstRespondedAt: reopening ? null : nextStatus === 'open' ? row.firstRespondedAt : row.firstRespondedAt ?? now,
      responseDueAt: reopening ? now + RESPONSE_WINDOWS[row.priority] : row.responseDueAt };
    check(await repository.update(row.id, row.version, next), 'STALE_VERSION', 'This case changed. Refresh before reviewing it.');
    await event(await repository.get(row.id), userId, `incident_${status}`, text(reason, 'Review reason', 5, 1000), now);
    return row.id;
  }
  return Object.freeze({ list, get, command, onIncident, syncIncident });
}
