import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';

const activeStatuses = new Set(['booked', 'on_way', 'arrived', 'in_progress']);
const identifier = (value) => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const canonical = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
const linkView = (row) => row ? { id: row.id, version: row.version, active: Boolean(row.active), expiresAt: row.expiresAt } : null;

/** A manually shared capability is read-only. Booking, fares, chat and payment stay with the booker. */
export function createGuestRidesService({ repository, getAccount, getTrip, locationForTrip, sessionOwner, nativeSessionOwner,
  unitOfWork, tokens, audit, clock }) {
  const actor = (id) => { const user = getAccount(id); check(user, 'UNAUTHENTICATED', 'Sign in to continue.'); return user; };
  const sessionUser = (binding) => binding?.startsWith('native:') ? nativeSessionOwner(binding.slice(7)) : sessionOwner(binding);
  const eligible = (ride) => ride.passenger.kind === 'guest' && activeStatuses.has(ride.status);
  function ownedRide(user, id) {
    check(identifier(id), 'NOT_FOUND', 'Guest ride not found.');
    const ride = getTrip(user, id);
    check(ride.customerId === user.id, 'NOT_FOUND', 'Guest ride not found.');
    return ride;
  }
  function end(row, now, reason) {
    if (!row?.active) return;
    repository.end(row.id, now, reason); audit.record(row.ownerId, `guest.link.${reason}`, row.id, now);
  }
  function invalidReason(row, now) {
    if (now >= row.expiresAt) return 'expired';
    if (sessionUser(row.sessionBinding) !== row.ownerId) return 'session_ended';
    const user = getAccount(row.ownerId);
    if (!user) return 'session_ended';
    return eligible(ownedRide(user, row.rideId)) ? null : 'trip_ended';
  }
  const sweep = () => unitOfWork(() => {
    const now = clock();
    for (const row of repository.activeLinks()) { const reason = invalidReason(row, now); if (reason) end(row, now, reason); }
  });
  const view = (ride, row = repository.latest(ride.rideId)) => ({ guest: { rideId: ride.rideId, canCreate: eligible(ride), link: linkView(row) } });
  function get(userId, rideId) {
    const ride = ownedRide(actor(userId), rideId); sweep(); return view(ride);
  }
  function command({ userId, sessionToken, nativeSessionId, rideId, action, data, key }) {
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const fingerprint = tokens.digest(canonical({ rideId, action, data }));
    sweep();
    return unitOfWork(() => {
      const user = actor(userId), ride = ownedRide(user, rideId), now = clock();
      check(typeof sessionToken === 'string' || typeof nativeSessionId === 'string', 'UNAUTHENTICATED', 'Sign in to manage the guest link.');
      const sessionBinding = nativeSessionId ? `native:${nativeSessionId}` : tokens.digest(sessionToken);
      check(sessionUser(sessionBinding) === user.id, 'UNAUTHENTICATED', 'The sharing session expired.');
      const previous = repository.command(user.id, key);
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This request key belongs to another guest link action.');
        return { ...view(ride, repository.link(previous.linkId)), replayed: true };
      }
      let linkId, token;
      if (action === 'link') {
        fields(data, ['expectedLinkId']);
        check(data.expectedLinkId === null || identifier(data.expectedLinkId), 'INVALID_INPUT', 'Use the guest link currently shown on screen.');
        check(eligible(ride), 'LINK_CLOSED', 'Confirm a ride for a guest before creating their trip link.');
        const current = repository.latest(rideId);
        check((current?.id ?? null) === data.expectedLinkId, 'STALE_VERSION', 'The guest link changed. Refresh before replacing it.');
        check(repository.count(rideId) < 30, 'LINK_LIMIT', 'This ride has reached its guest link limit.');
        end(current, now, 'replaced'); linkId = tokens.id(); token = tokens.generate();
        repository.add({ id: linkId, rideId, ownerId: user.id, tokenHash: tokens.digest(token), sessionBinding, now, expiresAt: now + 86_400_000 });
      } else if (action === 'revoke') {
        fields(data, ['linkId', 'expectedVersion']);
        check(identifier(data.linkId) && Number.isSafeInteger(data.expectedVersion) && data.expectedVersion >= 0, 'INVALID_INPUT', 'Use the current guest link and version.');
        const current = repository.latest(rideId);
        check(current?.id === data.linkId && current.version === data.expectedVersion, 'STALE_VERSION', 'The guest link changed. Refresh before revoking it.');
        check(current.active, 'LINK_CLOSED', 'This guest link has already ended.');
        end(current, now, 'revoked'); linkId = current.id;
      } else check(false, 'NOT_FOUND', 'Guest link action not found.');
      repository.saveCommand(user.id, key, fingerprint, linkId);
      audit.record(user.id, `guest.${action}`, linkId, now);
      return { ...view(ride, repository.link(linkId)), replayed: false, ...(token ? { token } : {}) };
    });
  }
  function sharedTrip(data) {
    fields(data, ['token']);
    check(typeof data.token === 'string' && /^[a-f0-9]{64}$/.test(data.token), 'NOT_FOUND', 'This guest trip link is unavailable or expired.');
    sweep(); const row = repository.byToken(tokens.digest(data.token));
    check(row, 'NOT_FOUND', 'This guest trip link is unavailable or expired.');
    const ride = ownedRide(actor(row.ownerId), row.rideId);
    return { mode: 'preview', expiresAt: row.expiresAt, guestTrip: {
      reference: `TAXI-${ride.rideId.slice(0, 8).toUpperCase()}`, status: ride.status, passengerName: ride.passenger.name, bookerName: ride.bookerName,
      pickup: ride.pickup, destination: ride.destination, driver: { name: ride.driver.name, vehicle: ride.driver.vehicle },
      pickupPin: ['booked', 'on_way', 'arrived'].includes(ride.status) ? ride.pickupPin : null, location: locationForTrip(row.rideId),
    } };
  }
  // Invoked by the owning ride transaction so completion/cancellation and revocation commit together.
  function closeRide(rideId, now) { for (const row of repository.forRide(rideId)) end(row, now, 'trip_ended'); }
  return Object.freeze({ get, command, sharedTrip, closeRide, sweep });
}
