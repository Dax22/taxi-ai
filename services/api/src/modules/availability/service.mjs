import { isRestricted, requireNewDriverWork } from '../../shared/service-restrictions.mjs';
import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { hasCapability, requireEligibleDriver } from '../../shared/policies.mjs';
import { AVAILABILITY_MS, POSITION_MS } from '../../../../../packages/shared/src/matching.mjs';
import { distanceMeters } from '../../../../../packages/shared/src/locations.mjs';
import { commandKey, clientIdentity, sequence, position, startData } from './domain.mjs';
import { asyncFilter } from '../../shared/async-collections.mjs';


/** Availability location stays inside the matching service boundary, never in public projections. */
export function createAvailabilityService({ repository, getAccount, sessionOwner, nativeSessionFor = () => null, nativeSessionOwner = () => null, isBusy, unitOfWork, tokens, audit, clock, allowSimulation = false }) {
  async function context(input, clientRequired = false) {
    const user = (await getAccount(input.userId));
    check(user && typeof input.sessionToken === 'string', 'UNAUTHENTICATED', 'Sign in to change availability.');
    check(hasCapability(user, 'driver'), 'FORBIDDEN', 'Driver availability requires a driver account.');
    const native = input.native === true ? (await nativeSessionFor(input.sessionToken)) : null;
    check(input.native !== true || native?.user.id === user.id, 'UNAUTHENTICATED', 'This device session has expired.');
    const nativeSessionId = native?.id ?? null;
    const sessionHash = tokens.digest(nativeSessionId ? `native:${nativeSessionId}` : input.sessionToken);
    check(nativeSessionId || (await sessionOwner(sessionHash)) === user.id, 'UNAUTHENTICATED', 'This session has expired.');
    const clientHash = input.clientId ? tokens.digest(clientIdentity(input.clientId)) : null;
    check(!clientRequired || clientHash, 'INVALID_AVAILABILITY_CLIENT', 'Use availability controls in this window.');
    return { user, userId: user.id, sessionHash, nativeSessionId, clientHash };
  }
  async function invalidReason(row, now) {
    const account = await getAccount(row.driverId), driver = account?.driver;
    if (isRestricted(account,'driver') || isRestricted(account,'vehicle')) return 'approval_changed';
    if (driver?.status !== 'approved' || !driver.eligibility?.eligible) return 'approval_changed';
    if ((row.nativeSessionId ? (await nativeSessionOwner(row.nativeSessionId)) : (await sessionOwner(row.sessionHash))) !== row.driverId) return 'session_ended';
    if ((row.mode === 'sample' && !allowSimulation) || now >= row.seenAt + AVAILABILITY_MS
      || (row.mode === 'gps' && now >= JSON.parse(row.positionJson).capturedAt + POSITION_MS)) return 'expired';
    if ((await isBusy(row.driverId))) return 'claimed';
    return null;
  }
  async function close(row, now, reason) {
    if (!row?.active) return;
    (await repository.stop(row.id, now, reason));
    (await audit.record(row.driverId, `availability.${reason}`, row.id, now));
  }
  let maintenanceCursor = '';
  async function validate(row, now) {
    if (row?.active) { const reason = (await invalidReason(row, now)); if (reason) { (await close(row, now, reason)); return null; } }
    return row;
  }
  // Request paths validate only their own lease. Maintenance processes bounded pages
  // and rotates through live rows so revoked sessions past the first page are visited.
  async function sweep() {
    (await unitOfWork(async () => {
      const now = clock();
      for (const row of (await repository.expired(now))) (await validate(row, now));
      const rows = (await repository.activePage(maintenanceCursor));
      for (const row of rows) (await validate(row, now));
      maintenanceCursor = rows.length === 200 ? rows.at(-1).id : '';
    }));
  }
  const validateCurrent = async (driverId) => (await unitOfWork(async () => (await validate((await repository.current(driverId)), clock()))));
  const expiry = (point, now) => Math.min(now + AVAILABILITY_MS, point ? point.capturedAt + POSITION_MS : Infinity);
  const owns = (row, ctx) => row.sessionHash === ctx.sessionHash && row.clientHash === ctx.clientHash;
  const view = (row, ctx) => row ? { id: row.id, online: Boolean(row.active), owned: Boolean(row.active && owns(row, ctx)),
    mode: row.mode, areaId: row.areaId, sequence: row.sequence, updatedAt: row.seenAt,
    expiresAt: row.active ? Math.min(row.seenAt + AVAILABILITY_MS, row.mode === 'gps' ? JSON.parse(row.positionJson).capturedAt + POSITION_MS : Infinity) : null,
    reason: row.reason } : null;
  async function owned(ctx, id) {
    const row = (await repository.find(id));
    check(row?.driverId === ctx.userId, 'NOT_FOUND', 'Availability session not found.');
    return row;
  }
  async function get(input) {
    const ctx = (await context(input)); (await validateCurrent(ctx.userId));
    return { availability: view((await repository.current(ctx.userId)), ctx), settings: { allowSimulation,
      heartbeatSeconds: 10, leaseSeconds: AVAILABILITY_MS / 1000, freshPositionSeconds: POSITION_MS / 1000 } };
  }
  async function command(input, action, id, data, key) {
    const ctx = (await context(input, true)); commandKey(key);
    const fingerprint = tokens.digest(JSON.stringify([action, id, ctx.sessionHash, ctx.clientHash, data]));
    (await validateCurrent(ctx.userId));
    return (await unitOfWork(async () => {
      const fresh = await context(input, true);
      const saved = (await repository.command(ctx.userId, key));
      if (saved) {
        check(saved.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another availability action.');
        return { availability: view((await owned(ctx, saved.id)), ctx), replayed: true };
      }
      const now = clock(); let row;
      if (action === 'online') {
        requireEligibleDriver(fresh.user); requireNewDriverWork(fresh.user);
        const value = startData(data, now, allowSimulation);
        check(!(await isBusy(ctx.userId)), 'DRIVER_BUSY', 'Finish your current negotiation or trip before going online.');
        check(!(await repository.current(ctx.userId)), 'AVAILABILITY_BUSY', 'You are already online. Go offline before starting from this window.');
        const nextId = tokens.id();
        (await repository.insert({ id: nextId, ...ctx, ...value, expiresAt: expiry(value.position, now), now }));
        (await audit.record(ctx.userId, 'availability.online', nextId, now)); row = (await repository.find(nextId));
      } else { fields(data, []); row = (await owned(ctx, id)); (await close(row, now, 'offline')); row = (await repository.find(id)); }
      (await repository.saveCommand(ctx.userId, key, fingerprint, row.id));
      return { availability: view(row, ctx), replayed: false };
    }));
  }
  async function update(input, id, data) {
    const ctx = (await context(input, true)); requireEligibleDriver(ctx.user); (await validateCurrent(ctx.userId));
    return (await unitOfWork(async () => {
      requireEligibleDriver((await context(input, true)).user);
      const row = (await owned(ctx, id));
      check(row.active && !(await invalidReason(row, clock())), 'AVAILABILITY_CLOSED', 'You are offline. Choose Go online to start again.');
      check(owns(row, ctx), 'AVAILABILITY_WINDOW', 'Only the window that went online can update availability.');
      fields(data, row.mode === 'gps' ? ['sequence', 'position'] : ['sequence']); sequence(data.sequence);
      const value = row.mode === 'gps' ? position(data.position, clock()) : null;
      if (data.sequence <= row.sequence) {
        check(data.sequence < row.sequence || (value ? JSON.stringify(value) : null) === row.positionJson, 'STALE_LOCATION', 'This sequence was already used for another location.');
        return { availability: view(row, ctx), replayed: true };
      }
      check(!value || value.capturedAt >= JSON.parse(row.positionJson).capturedAt, 'STALE_LOCATION', 'An older fix cannot replace a newer location.');
      (await repository.update(id, data.sequence, value, clock(), expiry(value, clock())));
      return { availability: view((await repository.find(id)), ctx), replayed: false };
    }));
  }
  // Internal ports: caller owns its transaction. Never export coordinates through HTTP.
  async function positionFor(driverId, now) {
    const row = (await repository.current(driverId));
    return row && !(await invalidReason(row, now)) ? { id: row.id, mode: row.mode, areaId: row.areaId,
      position: row.positionJson ? JSON.parse(row.positionJson) : null } : null;
  }
  async function nearby({ mode, areaId, position: pickup, radiusMeters, now = clock(), limit = 200, afterId = '' }, validateDrivers) {
    limit = Math.max(1, Math.min(200, Number.isSafeInteger(limit) ? limit : 200));
    if (mode !== 'sample' && (mode !== 'gps' || !Number.isFinite(pickup?.lat) || !Number.isFinite(pickup?.lng)
      || !Number.isFinite(radiusMeters) || radiusMeters <= 0 || radiusMeters > 10_000)) return { driverIds: [], nextCursor: null, scanned: 0 };
    // Conservative rectangle, followed by exact spherical distance before eligibility.
    const latitudeSpan = mode === 'gps' ? radiusMeters / 110_000 : 0;
    const longitudeSpan = mode === 'gps' ? latitudeSpan / Math.cos((Math.abs(pickup.lat) + latitudeSpan) * Math.PI / 180) : 0;
    const bounds = mode === 'gps' ? { minLat: pickup.lat - latitudeSpan, maxLat: pickup.lat + latitudeSpan,
      minLng: pickup.lng - longitudeSpan, maxLng: pickup.lng + longitudeSpan } : null;
    const rows = (await repository.nearby({ mode, areaId, bounds, position: pickup, radiusMeters, now, limit, afterId }));
    return { driverIds: (await asyncFilter(rows, async (row) => (mode === 'sample' || distanceMeters(pickup, JSON.parse(row.positionJson)) <= radiusMeters)
      && (!validateDrivers || !(await invalidReason(row, now))))).map((row) => row.driverId), nextCursor: rows.length === limit ? rows.at(-1).id : null, scanned: rows.length };
  }
  const nearbyDriverIds = (input) => nearby(input, true);
  // Internal broad-phase candidates only. Matching must apply the complete
  // batched eligibility projection before an edge is usable; never expose this
  // port through HTTP or use it for accepting a ride.
  const nearbyMatchingDriverIds = (input) => nearby(input, false);
  return Object.freeze({ get, command, update, sweep, positionFor, nearbyDriverIds, nearbyMatchingDriverIds,
    onProfileDeleted: async (driverId, now) => (await close((await repository.current(driverId)), now, 'approval_changed')),
    driverIds: async (afterId = '', limit = 200) => (await asyncFilter((await repository.activePage(afterId, limit)), async (r) => !(await invalidReason(r, clock())))).map((r) => r.driverId),
    onClaim: async (driverId, now) => (await close((await repository.current(driverId)), now, 'claimed')) });
}
