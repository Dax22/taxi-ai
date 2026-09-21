import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { requireRole } from '../../shared/policies.mjs';
import { ABUJA_BOUNDS, insideAbuja, canShareLocation } from '../../../../../packages/shared/src/locations.mjs';
import { key, clientIdentity, endpoints, point, checkedRoute, position, QUOTE_MS, FRESH_MS, SHARE_MS } from './domain.mjs';

export function createLocationsService({ repository, provider, getAccount, sessionOwner, nativeSessionOwner = () => null, getRideContext, unitOfWork, tokens, audit, clock }) {
  function context(input, clientRequired = false, planning = false) {
    const user = getAccount(input.userId);
    check(user && typeof input.sessionToken === 'string', 'UNAUTHENTICATED', 'Sign in to use locations.');
    requireRole(user, 'customer');
    const sessionHash = tokens.digest(input.sessionToken);
    const owner = planning && input.native === true ? nativeSessionOwner : sessionOwner;
    check(owner(sessionHash) === user.id, 'UNAUTHENTICATED', 'This location session has expired.');
    const clientHash = input.clientId ? tokens.digest(clientIdentity(input.clientId)) : null;
    check(!clientRequired || clientHash, 'INVALID_LOCATION_CLIENT', 'Use location controls in this window.');
    return { user, userId: user.id, sessionHash, clientHash };
  }
  const planningContext = (input) => context(input, false, true);
  function settings(input) { planningContext(input); return { ...provider.describe(), bounds: ABUJA_BOUNDS, quoteSeconds: QUOTE_MS / 1000 }; }
  async function search(input, data) {
    planningContext(input); fields(data, ['query']);
    const query = label(data.query, 'Address search', 3, 160);
    const found = await provider.search(query, ABUJA_BOUNDS);
    planningContext(input); // A logout during provider I/O must not deliver a stale account result.
    const places = found.filter((item) => insideAbuja(item) && typeof item.name === 'string' && item.name.trim().length >= 2
      && !/[\u0000-\u001f\u007f]/u.test(item.name)).map(point);
    return { places, attribution: '© OpenStreetMap contributors · Photon search' };
  }
  const quoteView = (row) => ({ id: row.id, createdAt: row.createdAt, expiresAt: row.expiresAt, rideId: row.rideId, route: row.route });
  function ownedQuote(userId, id) {
    const quote = repository.quote(id);
    check(quote && quote.customerId === userId, 'NOT_FOUND', 'Route quote not found.');
    return quote;
  }
  function quoteReplay(userId, commandKey, fingerprint) {
    const saved = repository.quoteCommand(userId, commandKey);
    if (!saved) return null;
    check(saved.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another route preview.');
    return { quote: quoteView(ownedQuote(userId, saved.id)), replayed: true };
  }
  async function quote(input, data, commandKey) {
    const ctx = planningContext(input); requireRole(ctx.user, 'customer'); key(commandKey);
    const points = endpoints(data), fingerprint = tokens.digest(JSON.stringify(points));
    const replay = quoteReplay(ctx.userId, commandKey, fingerprint);
    if (replay) return replay;
    check(repository.recentQuotes(ctx.userId, clock() - 60_000) < 10, 'RATE_LIMITED', 'Wait before requesting more route previews.');
    const route = checkedRoute(await provider.route(points.pickup, points.destination), points);
    // Provider I/O is outside the synchronous transaction. Recheck authorization,
    // retry key and limits inside it before committing the server-owned quote.
    return unitOfWork(() => {
      const fresh = planningContext(input); requireRole(fresh.user, 'customer');
      const previous = quoteReplay(fresh.userId, commandKey, fingerprint); if (previous) return previous;
      const now = clock();
      check(repository.recentQuotes(fresh.userId, now - 60_000) < 10, 'RATE_LIMITED', 'Wait before requesting more route previews.');
      const id = tokens.id();
      repository.saveQuote({ id, userId: fresh.userId, now, expiresAt: now + QUOTE_MS, route });
      repository.saveQuoteCommand(fresh.userId, commandKey, fingerprint, id);
      audit.record(fresh.userId, 'location.quote', id, now);
      return { quote: quoteView(repository.quote(id)), replayed: false };
    });
  }
  // Rides calls these ports within its existing transaction. No nested writes.
  function quoteForRide(userId, id, now) {
    const row = ownedQuote(userId, id);
    check(!row.rideId, 'QUOTE_USED', 'This route quote already belongs to a ride.');
    check(now < row.expiresAt, 'QUOTE_EXPIRED', 'Preview the route again before requesting this ride.');
    return row.route;
  }
  function bindQuote(userId, id, rideId, now) {
    quoteForRide(userId, id, now);
    check(repository.bindQuote(id, rideId), 'QUOTE_USED', 'This route quote was already used.');
  }
  function close(share, now) {
    if (!share?.active) return;
    repository.stop(share.id, now);
    audit.record(share.driverId, 'location.stopped', share.id, now);
  }
  function closeRide(id, now) { close(repository.currentShare(id), now); }
  function expire() {
    const now = clock();
    for (const share of repository.activeShares()) {
      const driver = getAccount(share.driverId);
      const ride = getRideContext(driver, share.rideId);
      if (!canShareLocation(ride.status) || driver.driver?.status !== 'approved'
        || sessionOwner(share.sessionHash) !== share.driverId || now >= share.seenAt + SHARE_MS) close(share, now);
    }
    repository.pruneQuotes(now);
  }
  const sweep = () => unitOfWork(expire);
  const owns = (share, ctx) => share.driverId === ctx.userId && share.sessionHash === ctx.sessionHash && share.clientHash === ctx.clientHash;
  function shareView(share, ctx) {
    if (!share) return null;
    const current = share.positionJson ? JSON.parse(share.positionJson) : null;
    return { id: share.id, rideId: share.rideId, active: Boolean(share.active), owned: owns(share, ctx),
      sequence: share.sequence, startedAt: share.startedAt, updatedAt: current ? share.seenAt : null,
      stale: !current || clock() - current.capturedAt >= FRESH_MS, position: current };
  }
  function tracking(input, rideId) {
    const ctx = context(input);
    const ride = getRideContext(ctx.user, rideId);
    if (ride.driverId === ctx.userId) requireRole(ctx.user, 'driver');
    sweep();
    return { share: shareView(repository.currentShare(rideId), ctx) };
  }
  function driverShare(ctx, id) {
    const share = repository.share(id);
    check(share?.driverId === ctx.userId, 'NOT_FOUND', 'Location sharing not found.');
    getRideContext(ctx.user, share.rideId);
    return share;
  }
  function shareCommand(input, action, id, data, commandKey) {
    const ctx = context(input, true); requireRole(ctx.user, 'driver'); fields(data, []); key(commandKey);
    const fingerprint = tokens.digest(JSON.stringify([action, id, ctx.clientHash]));
    sweep();
    return unitOfWork(() => {
      const saved = repository.shareCommand(ctx.userId, commandKey);
      if (saved) {
        check(saved.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another location action.');
        return { share: shareView(driverShare(ctx, saved.id), ctx), replayed: true };
      }
      const now = clock(); let share;
      if (action === 'start') {
        const ride = getRideContext(ctx.user, id);
        check(ride.driverId === ctx.userId && canShareLocation(ride.status), 'LOCATION_CLOSED', 'Location sharing opens for the assigned driver after booking confirmation.');
        check(!repository.currentShare(id), 'LOCATION_BUSY', 'Location is already being shared. Stop that session before starting here.');
        const shareId = tokens.id();
        repository.saveShare({ id: shareId, rideId: id, driverId: ctx.userId, sessionHash: ctx.sessionHash, clientHash: ctx.clientHash, now });
        audit.record(ctx.userId, 'location.started', shareId, now);
        share = repository.share(shareId);
      } else {
        share = driverShare(ctx, id); close(share, now); share = repository.share(id);
      }
      repository.saveShareCommand(ctx.userId, commandKey, fingerprint, share.id);
      return { share: shareView(share, ctx), replayed: false };
    });
  }
  function update(input, id, data) {
    const ctx = context(input, true); requireRole(ctx.user, 'driver');
    const value = position(data, clock());
    sweep();
    return unitOfWork(() => {
      const share = driverShare(ctx, id);
      check(share.active, 'LOCATION_CLOSED', 'Location sharing has ended.');
      check(owns(share, ctx), 'LOCATION_WINDOW', 'Only the browser window that started sharing may update it.');
      if (data.sequence <= share.sequence) {
        check(data.sequence < share.sequence || JSON.stringify(value) === share.positionJson, 'STALE_LOCATION', 'This sequence belongs to a different location.');
        return { share: shareView(share, ctx), replayed: true };
      }
      const previous = share.positionJson ? JSON.parse(share.positionJson) : null;
      check(!previous || value.capturedAt >= previous.capturedAt, 'STALE_LOCATION', 'An older GPS fix cannot replace a newer one.');
      repository.update(id, data.sequence, value, clock());
      return { share: shareView(repository.share(id), ctx), replayed: false };
    });
  }
  // Read-only port: the safety use case already checked ride access. No nested writes.
  function safetyPosition(rideId) {
    const share = repository.currentShare(rideId), now = clock();
    if (!share?.positionJson || now >= share.seenAt + SHARE_MS || sessionOwner(share.sessionHash) !== share.driverId
      || getAccount(share.driverId)?.driver?.status !== 'approved') return null;
    const point = JSON.parse(share.positionJson);
    return { ...point, source: 'driver_shared', stale: now - point.capturedAt >= FRESH_MS };
  }
  return Object.freeze({ settings, search, quote, quoteForRide, bindQuote, routeForRide: repository.rideRoute,
    tracking, shareCommand, update, sweep, closeRide, safetyPosition });
}
