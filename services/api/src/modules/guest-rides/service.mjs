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
  const actor = async (id) => { const user = (await getAccount(id)); check(user, 'UNAUTHENTICATED', 'Sign in to continue.'); return user; };
  const sessionUser = async (binding) => binding?.startsWith('native:') ? (await nativeSessionOwner(binding.slice(7))) : (await sessionOwner(binding));
  const eligible = (ride) => ride.passenger.kind === 'guest' && activeStatuses.has(ride.status);
  async function ownedRide(user, id) {
    check(identifier(id), 'NOT_FOUND', 'Guest ride not found.');
    const ride = (await getTrip(user, id));
    check(ride.customerId === user.id, 'NOT_FOUND', 'Guest ride not found.');
    return ride;
  }
  async function end(row, now, reason) {
    if (!row?.active) return;
    (await repository.end(row.id, now, reason)); (await audit.record(row.ownerId, `guest.link.${reason}`, row.id, now));
  }
  async function invalidReason(row, now) {
    if (now >= row.expiresAt) return 'expired';
    if ((await sessionUser(row.sessionBinding)) !== row.ownerId) return 'session_ended';
    const user = (await getAccount(row.ownerId));
    if (!user) return 'session_ended';
    return eligible((await ownedRide(user, row.rideId))) ? null : 'trip_ended';
  }
  const sweep = async () => (await unitOfWork(async () => {
    const now = clock();
    for (const row of (await repository.activeLinks())) { const reason = (await invalidReason(row, now)); if (reason) (await end(row, now, reason)); }
  }));
  const view = async (ride, row) => {
    if (row === undefined) row = (await repository.latest(ride.rideId));
    return { guest: { rideId: ride.rideId, canCreate: eligible(ride), link: linkView(row) } };
  };
  async function get(userId, rideId) {
    const ride = (await ownedRide((await actor(userId)), rideId)); (await sweep()); return (await view(ride));
  }
  async function command({ userId, sessionToken, nativeSessionId, rideId, action, data, key }) {
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const fingerprint = tokens.digest(canonical({ rideId, action, data }));
    (await sweep());
    return (await unitOfWork(async () => {
      const user = (await actor(userId)), ride = (await ownedRide(user, rideId)), now = clock();
      check(typeof sessionToken === 'string' || typeof nativeSessionId === 'string', 'UNAUTHENTICATED', 'Sign in to manage the guest link.');
      const sessionBinding = nativeSessionId ? `native:${nativeSessionId}` : tokens.digest(sessionToken);
      check((await sessionUser(sessionBinding)) === user.id, 'UNAUTHENTICATED', 'The sharing session expired.');
      const previous = (await repository.command(user.id, key));
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This request key belongs to another guest link action.');
        return { ...(await view(ride, (await repository.link(previous.linkId)))), replayed: true };
      }
      let linkId, token;
      if (action === 'link') {
        fields(data, ['expectedLinkId']);
        check(data.expectedLinkId === null || identifier(data.expectedLinkId), 'INVALID_INPUT', 'Use the guest link currently shown on screen.');
        check(eligible(ride), 'LINK_CLOSED', 'Confirm a ride for a guest before creating their trip link.');
        const current = (await repository.latest(rideId));
        check((current?.id ?? null) === data.expectedLinkId, 'STALE_VERSION', 'The guest link changed. Refresh before replacing it.');
        check((await repository.count(rideId)) < 30, 'LINK_LIMIT', 'This ride has reached its guest link limit.');
        (await end(current, now, 'replaced')); linkId = tokens.id(); token = tokens.generate();
        (await repository.add({ id: linkId, rideId, ownerId: user.id, tokenHash: tokens.digest(token), sessionBinding, now, expiresAt: now + 86_400_000 }));
      } else if (action === 'revoke') {
        fields(data, ['linkId', 'expectedVersion']);
        check(identifier(data.linkId) && Number.isSafeInteger(data.expectedVersion) && data.expectedVersion >= 0, 'INVALID_INPUT', 'Use the current guest link and version.');
        const current = (await repository.latest(rideId));
        check(current?.id === data.linkId && current.version === data.expectedVersion, 'STALE_VERSION', 'The guest link changed. Refresh before revoking it.');
        check(current.active, 'LINK_CLOSED', 'This guest link has already ended.');
        (await end(current, now, 'revoked')); linkId = current.id;
      } else check(false, 'NOT_FOUND', 'Guest link action not found.');
      (await repository.saveCommand(user.id, key, fingerprint, linkId));
      (await audit.record(user.id, `guest.${action}`, linkId, now));
      return { ...(await view(ride, (await repository.link(linkId)))), replayed: false, ...(token ? { token } : {}) };
    }));
  }
  async function sharedTrip(data) {
    fields(data, ['token']);
    check(typeof data.token === 'string' && /^[a-f0-9]{64}$/.test(data.token), 'NOT_FOUND', 'This guest trip link is unavailable or expired.');
    (await sweep()); const row = (await repository.byToken(tokens.digest(data.token)));
    check(row, 'NOT_FOUND', 'This guest trip link is unavailable or expired.');
    const ride = (await ownedRide((await actor(row.ownerId)), row.rideId));
    return { mode: 'preview', expiresAt: row.expiresAt, guestTrip: {
      reference: `TAXI-${ride.rideId.slice(0, 8).toUpperCase()}`, status: ride.status, passengerName: ride.passenger.name, bookerName: ride.bookerName,
      pickup: ride.pickup, destination: ride.destination, driver: { name: ride.driver.name, vehicle: ride.driver.vehicle },
      pickupPin: ['booked', 'on_way', 'arrived'].includes(ride.status) ? ride.pickupPin : null, location: (await locationForTrip(row.rideId)),
    } };
  }
  // Invoked by the owning ride transaction so completion/cancellation and revocation commit together.
  async function closeRide(rideId, now) { for (const row of (await repository.forRide(rideId))) (await end(row, now, 'trip_ended')); }
  return Object.freeze({ get, command, sharedTrip, closeRide, sweep });
}
