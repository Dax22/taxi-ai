import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { hasCapability, requireEligibleDriver } from '../../shared/policies.mjs';
import { AVAILABILITY_MS, POSITION_MS } from '../../../../../packages/shared/src/matching.mjs';
import { commandKey, clientIdentity, sequence, position, startData } from './domain.mjs';

/** Availability location stays inside the matching service boundary, never in public projections. */
export function createAvailabilityService({ repository, getAccount, sessionOwner, isBusy, unitOfWork, tokens, audit, clock, allowSimulation = false }) {
  function context(input, clientRequired = false) {
    const user = getAccount(input.userId);
    check(user && typeof input.sessionToken === 'string', 'UNAUTHENTICATED', 'Sign in to change availability.');
    check(hasCapability(user, 'driver'), 'FORBIDDEN', 'Driver availability requires a driver account.');
    const sessionHash = tokens.digest(input.sessionToken);
    check(sessionOwner(sessionHash) === user.id, 'UNAUTHENTICATED', 'This session has expired.');
    const clientHash = input.clientId ? tokens.digest(clientIdentity(input.clientId)) : null;
    check(!clientRequired || clientHash, 'INVALID_AVAILABILITY_CLIENT', 'Use availability controls in this window.');
    return { user, userId: user.id, sessionHash, clientHash };
  }
  function invalidReason(row, now) {
    const driver = getAccount(row.driverId)?.driver;
    if (driver?.status !== 'approved' || !driver.eligibility?.eligible) return 'approval_changed';
    if (sessionOwner(row.sessionHash) !== row.driverId) return 'session_ended';
    if ((row.mode === 'sample' && !allowSimulation) || now >= row.seenAt + AVAILABILITY_MS
      || (row.mode === 'gps' && now >= JSON.parse(row.positionJson).capturedAt + POSITION_MS)) return 'expired';
    if (isBusy(row.driverId)) return 'claimed';
    return null;
  }
  function close(row, now, reason) {
    if (!row?.active) return;
    repository.stop(row.id, now, reason);
    audit.record(row.driverId, `availability.${reason}`, row.id, now);
  }
  function sweep() {
    unitOfWork(() => {
      const now = clock();
      for (const row of repository.active()) { const reason = invalidReason(row, now); if (reason) close(row, now, reason); }
    });
  }
  const owns = (row, ctx) => row.sessionHash === ctx.sessionHash && row.clientHash === ctx.clientHash;
  const view = (row, ctx) => row ? { id: row.id, online: Boolean(row.active), owned: Boolean(row.active && owns(row, ctx)),
    mode: row.mode, areaId: row.areaId, sequence: row.sequence, updatedAt: row.seenAt,
    expiresAt: row.active ? Math.min(row.seenAt + AVAILABILITY_MS, row.mode === 'gps' ? JSON.parse(row.positionJson).capturedAt + POSITION_MS : Infinity) : null,
    reason: row.reason } : null;
  function owned(ctx, id) {
    const row = repository.find(id);
    check(row?.driverId === ctx.userId, 'NOT_FOUND', 'Availability session not found.');
    return row;
  }
  function get(input) {
    const ctx = context(input); sweep();
    return { availability: view(repository.current(ctx.userId), ctx), settings: { allowSimulation,
      heartbeatSeconds: 10, leaseSeconds: AVAILABILITY_MS / 1000, freshPositionSeconds: POSITION_MS / 1000 } };
  }
  function command(input, action, id, data, key) {
    const ctx = context(input, true); commandKey(key);
    const fingerprint = tokens.digest(JSON.stringify([action, id, ctx.sessionHash, ctx.clientHash, data]));
    sweep();
    return unitOfWork(() => {
      const saved = repository.command(ctx.userId, key);
      if (saved) {
        check(saved.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another availability action.');
        return { availability: view(owned(ctx, saved.id), ctx), replayed: true };
      }
      const now = clock(); let row;
      if (action === 'online') {
        requireEligibleDriver(ctx.user);
        const value = startData(data, now, allowSimulation);
        check(!isBusy(ctx.userId), 'DRIVER_BUSY', 'Finish your current negotiation or trip before going online.');
        check(!repository.current(ctx.userId), 'AVAILABILITY_BUSY', 'You are already online. Go offline before starting from this window.');
        const nextId = tokens.id();
        repository.insert({ id: nextId, ...ctx, ...value, now });
        audit.record(ctx.userId, 'availability.online', nextId, now); row = repository.find(nextId);
      } else { fields(data, []); row = owned(ctx, id); close(row, now, 'offline'); row = repository.find(id); }
      repository.saveCommand(ctx.userId, key, fingerprint, row.id);
      return { availability: view(row, ctx), replayed: false };
    });
  }
  function update(input, id, data) {
    const ctx = context(input, true); requireEligibleDriver(ctx.user); sweep();
    return unitOfWork(() => {
      const row = owned(ctx, id);
      check(row.active, 'AVAILABILITY_CLOSED', 'You are offline. Choose Go online to start again.');
      check(owns(row, ctx), 'AVAILABILITY_WINDOW', 'Only the window that went online can update availability.');
      fields(data, row.mode === 'gps' ? ['sequence', 'position'] : ['sequence']); sequence(data.sequence);
      const value = row.mode === 'gps' ? position(data.position, clock()) : null;
      if (data.sequence <= row.sequence) {
        check(data.sequence < row.sequence || (value ? JSON.stringify(value) : null) === row.positionJson, 'STALE_LOCATION', 'This sequence was already used for another location.');
        return { availability: view(row, ctx), replayed: true };
      }
      check(!value || value.capturedAt >= JSON.parse(row.positionJson).capturedAt, 'STALE_LOCATION', 'An older fix cannot replace a newer location.');
      repository.update(id, data.sequence, value, clock());
      return { availability: view(repository.find(id), ctx), replayed: false };
    });
  }
  // Internal ports: caller owns its transaction. Never export coordinates through HTTP.
  function positionFor(driverId, now) {
    const row = repository.current(driverId);
    return row && !invalidReason(row, now) ? { mode: row.mode, areaId: row.areaId,
      position: row.positionJson ? JSON.parse(row.positionJson) : null } : null;
  }
  return Object.freeze({ get, command, update, sweep, positionFor,
    onClaim: (driverId, now) => close(repository.current(driverId), now, 'claimed') });
}
