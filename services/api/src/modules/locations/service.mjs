import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { requireRole } from '../../shared/policies.mjs';
import { transportCategory } from '../../../../../packages/shared/src/transport-categories.mjs';
import { NIGERIA_BOUNDS, insideNigeria, canShareLocation } from '../../../../../packages/shared/src/locations.mjs';
import { key, clientIdentity, endpoints, point, checkedRoute, directQuote, position, QUOTE_MS, FRESH_MS, SHARE_MS } from './domain.mjs';
import { createRidePilotConfig } from '../../../../../packages/shared/src/ride-pilot.mjs';

export function createLocationsService({ repository, provider, getAccount, sessionOwner, nativeAccessOwner = () => null, nativeSessionOwner = () => null, getRideContext, unitOfWork, tokens, audit, clock, onChange = async () => {}, ridePilot = createRidePilotConfig() }) {
  async function context(input, clientRequired = false, planning = false) {
    const user = (await getAccount(input.userId));
    check(user, 'UNAUTHENTICATED', 'Sign in to use locations.');
    requireRole(user, 'customer');
    let sessionHash;
    if (!planning && typeof input.nativeSessionId === 'string') {
      // A native share belongs to the device family, so rotating its access token
      // neither ends sharing nor lets a different device publish positions.
      check((await nativeSessionOwner(input.nativeSessionId)) === user.id, 'UNAUTHENTICATED', 'This location session has expired.');
      sessionHash = `native:${input.nativeSessionId}`;
    } else {
      check(typeof input.sessionToken === 'string', 'UNAUTHENTICATED', 'Sign in to use locations.');
      sessionHash = tokens.digest(input.sessionToken);
      const owner = planning && input.native === true ? nativeAccessOwner : sessionOwner;
      check((await owner(sessionHash)) === user.id, 'UNAUTHENTICATED', 'This location session has expired.');
    }
    const clientHash = input.clientId ? tokens.digest(clientIdentity(input.clientId)) : null;
    check(!(clientRequired || input.nativeSessionId) || clientHash, 'INVALID_LOCATION_CLIENT', 'Use location controls on this device or window.');
    return { user, userId: user.id, sessionHash, clientHash };
  }
  const planningContext = async (input) => (await context(input, false, true));
  async function settings(input) { (await planningContext(input)); return { ...provider.describe(), bounds: NIGERIA_BOUNDS, quoteSeconds: QUOTE_MS / 1000 }; }
  async function search(input, data) {
    (await planningContext(input)); fields(data, ['query']);
    const query = label(data.query, 'Address search', 3, 160);
    const found = await provider.search(query, NIGERIA_BOUNDS);
    (await planningContext(input)); // A logout during provider I/O must not deliver a stale account result.
    const places = found.filter((item) => insideNigeria(item) && typeof item.name === 'string' && item.name.trim().length >= 2
      && !/[\u0000-\u001f\u007f]/u.test(item.name)).map(point);
    return { places, attribution: '© OpenStreetMap contributors · Photon search' };
  }
  const publicRoute = (route) => {
    const { ridePilotCoverage, ...visible } = route;
    return visible;
  };
  const quoteView = (row) => ({ id: row.id, createdAt: row.createdAt, expiresAt: row.expiresAt, rideId: row.rideId, route: publicRoute(row.route) });
  async function ownedQuote(userId, id) {
    const quote = (await repository.quote(id));
    check(quote && quote.customerId === userId, 'NOT_FOUND', 'Route quote not found.');
    return quote;
  }
  async function quoteReplay(userId, commandKey, fingerprint) {
    const saved = (await repository.quoteCommand(userId, commandKey));
    if (!saved) return null;
    check(saved.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another route preview.');
    return { quote: quoteView((await ownedQuote(userId, saved.id))), replayed: true };
  }
  async function quote(input, data, commandKey) {
    const ctx = (await planningContext(input)); requireRole(ctx.user, 'customer'); key(commandKey);
    const points = endpoints(data), fingerprint = tokens.digest(JSON.stringify(points));
    const replay = (await quoteReplay(ctx.userId, commandKey, fingerprint));
    if (replay) return replay;
    check((await repository.recentQuotes(ctx.userId, clock() - 60_000)) < 10, 'RATE_LIMITED', 'Wait before requesting more route previews.');
    const passengerCategory = transportCategory(points.vehicleCategory).service === 'ride';
    const providerRoute = passengerCategory ? await provider.route(points.pickup, points.destination) : null;
    const route = passengerCategory ? checkedRoute(providerRoute, points) : directQuote(points);
    const coverage = passengerCategory && ridePilot.coverage(providerRoute.coordinates, [points.pickup, points.destination]);
    if (coverage) route.ridePilotCoverage = coverage;
    // Provider I/O is outside the database transaction. Recheck authorization,
    // retry key and limits inside it before committing the server-owned quote.
    return (await unitOfWork(async () => {
      const fresh = (await planningContext(input)); requireRole(fresh.user, 'customer');
      const previous = (await quoteReplay(fresh.userId, commandKey, fingerprint)); if (previous) return previous;
      const now = clock();
      check((await repository.recentQuotes(fresh.userId, now - 60_000)) < 10, 'RATE_LIMITED', 'Wait before requesting more route previews.');
      const id = tokens.id();
      (await repository.saveQuote({ id, userId: fresh.userId, now, expiresAt: now + QUOTE_MS, route }));
      (await repository.saveQuoteCommand(fresh.userId, commandKey, fingerprint, id));
      (await audit.record(fresh.userId, 'location.quote', id, now));
      return { quote: quoteView((await repository.quote(id))), replayed: false };
    }));
  }
  // Rides calls these ports within its existing transaction. No nested writes.
  async function quoteForRide(userId, id, now) {
    const row = (await ownedQuote(userId, id));
    check(!row.rideId, 'QUOTE_USED', 'This route quote already belongs to a ride.');
    check(now < row.expiresAt, 'QUOTE_EXPIRED', 'Preview the route again before requesting this ride.');
    return row.route;
  }
  async function bindQuote(userId, id, rideId, now) {
    (await quoteForRide(userId, id, now));
    check((await repository.bindQuote(id, rideId)), 'QUOTE_USED', 'This route quote was already used.');
  }
  async function close(share, now) {
    if (!share?.active) return;
    (await repository.stop(share.id, now));
    (await audit.record(share.driverId, 'location.stopped', share.id, now));
    await onChange(share.rideId, now);
  }
  async function closeRide(id, now) { (await close((await repository.currentShare(id)), now)); }
  const shareOwner = async (binding) => binding?.startsWith('native:') ? (await nativeSessionOwner(binding.slice(7))) : (await sessionOwner(binding));
  let maintenanceCursor = '';
  async function validate(share, now) {
    if (!share?.active) return share;
    const driver = (await getAccount(share.driverId));
    if (driver?.driver?.status !== 'approved' || (await shareOwner(share.sessionHash)) !== share.driverId
      || now >= share.seenAt + SHARE_MS || !canShareLocation((await getRideContext(driver, share.rideId)).status)) {
      (await close(share, now)); return null;
    }
    return share;
  }
  async function expire() {
    const now = clock();
    for (const share of (await repository.expired(now - SHARE_MS))) (await validate(share, now));
    const rows = (await repository.activePage(maintenanceCursor));
    for (const share of rows) (await validate(share, now));
    maintenanceCursor = rows.length === 200 ? rows.at(-1).id : '';
    (await repository.pruneQuotes(now));
  }
  const sweep = async () => (await unitOfWork(expire));
  const owns = (share, ctx) => share.driverId === ctx.userId && share.sessionHash === ctx.sessionHash && share.clientHash === ctx.clientHash;
  function shareView(share, ctx) {
    if (!share) return null;
    const current = share.positionJson ? JSON.parse(share.positionJson) : null;
    return { id: share.id, rideId: share.rideId, active: Boolean(share.active), owned: owns(share, ctx),
      sequence: share.sequence, startedAt: share.startedAt, updatedAt: current ? share.seenAt : null,
      stale: !current || clock() - current.capturedAt >= FRESH_MS, position: current };
  }
  async function tracking(input, rideId) {
    const ctx = (await context(input));
    const ride = (await getRideContext(ctx.user, rideId));
    const isDriver = ride.driverId === ctx.userId;
    if (isDriver && !input.nativeSessionId) requireRole(ctx.user, 'driver');
    (await unitOfWork(async () => (await validate((await repository.currentShare(rideId)), clock()))));
    return { rideId, isDriver, canShare: isDriver && ctx.user.driver?.status === 'approved' && canShareLocation(ride.status),
      share: shareView((await repository.currentShare(rideId)), ctx) };
  }
  async function driverShare(ctx, id) {
    const share = (await repository.share(id));
    check(share?.driverId === ctx.userId, 'NOT_FOUND', 'Location sharing not found.');
    (await getRideContext(ctx.user, share.rideId));
    return share;
  }
  async function shareCommand(input, action, id, data, commandKey) {
    const ctx = (await context(input, true)); requireRole(ctx.user, 'driver'); fields(data, []); key(commandKey);
    const fingerprint = tokens.digest(JSON.stringify([action, id, ctx.clientHash]));
    (await unitOfWork(async () => (await validate((await repository.currentForDriver(ctx.userId)), clock()))));
    return (await unitOfWork(async () => {
      requireRole((await context(input, true)).user, 'driver');
      const saved = (await repository.shareCommand(ctx.userId, commandKey));
      if (saved) {
        check(saved.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another location action.');
        return { share: shareView((await driverShare(ctx, saved.id)), ctx), replayed: true };
      }
      const now = clock(); let share;
      if (action === 'start') {
        const ride = (await getRideContext(ctx.user, id));
        check(ride.driverId === ctx.userId && canShareLocation(ride.status), 'LOCATION_CLOSED', 'Location sharing opens for the assigned driver after booking confirmation.');
        check(!(await repository.currentShare(id)), 'LOCATION_BUSY', 'Location is already being shared. Stop that session before starting here.');
        const shareId = tokens.id();
        (await repository.saveShare({ id: shareId, rideId: id, driverId: ctx.userId, sessionHash: ctx.sessionHash, clientHash: ctx.clientHash, now }));
        (await audit.record(ctx.userId, 'location.started', shareId, now));
        await onChange(id, now);
        share = (await repository.share(shareId));
      } else {
        share = (await driverShare(ctx, id)); (await close(share, now)); share = (await repository.share(id));
      }
      (await repository.saveShareCommand(ctx.userId, commandKey, fingerprint, share.id));
      return { share: shareView(share, ctx), replayed: false };
    }));
  }
  async function update(input, id, data) {
    const ctx = (await context(input, true)); requireRole(ctx.user, 'driver');
    const value = position(data, clock());
    (await unitOfWork(async () => (await validate((await driverShare(ctx, id)), clock()))));
    return (await unitOfWork(async () => {
      requireRole((await context(input, true)).user, 'driver');
      const share = (await driverShare(ctx, id));
      check(share.active && await validate(share, clock()), 'LOCATION_CLOSED', 'Location sharing has ended.');
      check(owns(share, ctx), 'LOCATION_WINDOW', 'Only the device or browser window that started sharing may update it.');
      if (data.sequence <= share.sequence) {
        check(data.sequence < share.sequence || JSON.stringify(value) === share.positionJson, 'STALE_LOCATION', 'This sequence belongs to a different location.');
        return { share: shareView(share, ctx), replayed: true };
      }
      const previous = share.positionJson ? JSON.parse(share.positionJson) : null;
      check(!previous || value.capturedAt >= previous.capturedAt, 'STALE_LOCATION', 'An older GPS fix cannot replace a newer one.');
      (await repository.update(id, data.sequence, value, clock()));
      await onChange(share.rideId, clock());
      return { share: shareView((await repository.share(id)), ctx), replayed: false };
    }));
  }
  // Read-only port: the safety use case already checked ride access. No nested writes.
  async function safetyPosition(rideId) {
    const share = (await repository.currentShare(rideId)), now = clock();
    if (!share?.positionJson || now >= share.seenAt + SHARE_MS || (await shareOwner(share.sessionHash)) !== share.driverId
      || (await getAccount(share.driverId))?.driver?.status !== 'approved'
      || !canShareLocation((await getRideContext((await getAccount(share.driverId)), rideId)).status)) return null;
    const point = JSON.parse(share.positionJson);
    return { ...point, source: 'driver_shared', stale: now - point.capturedAt >= FRESH_MS };
  }
  return Object.freeze({ settings, search, quote, quoteForRide, bindQuote,
    routeForRide: async (rideId) => { const route = await repository.rideRoute(rideId); return route && publicRoute(route); },
    tracking, shareCommand, update, sweep, closeRide, safetyPosition });
}
