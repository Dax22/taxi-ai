import { check } from '../../shared/errors.mjs';
import { fields, emailAddress } from '../../shared/validation.mjs';
import { hasCapability } from '../../shared/policies.mjs';

const identifier = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const terminal = new Set(['completed', 'cancelled', 'expired']);
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const unavailable = () => check(false, 'NOT_FOUND', 'This parcel invitation is unavailable. Ask the sender for a new invitation.');

/** Recipient access starts with explicit authenticated acceptance, never with opening a public URL. */
export function createParcelTrackingService({ repository, getAccount, getTrip, locationForTrip, unitOfWork, tokens, audit, clock }) {
  const emailHash = (email, linkId) => tokens.digest(`${linkId}:${emailAddress(email).toLowerCase()}`);
  const recipientMatches = (user, row) => Boolean(user?.emailVerified && row?.intendedEmailHash
    && tokens.equal(emailHash(user.email, row.id), row.intendedEmailHash));
  async function actor(id) {
    const user = await getAccount(id);
    check(user, 'UNAUTHENTICATED', 'Sign in to continue.');
    check(hasCapability(user, 'customer'), 'FORBIDDEN', 'Use a customer account to track a parcel.');
    return user;
  }
  async function owned(user, rideId) {
    check(identifier(rideId), 'NOT_FOUND', 'Parcel not found.');
    const ride = await getTrip(user, rideId);
    check(ride.customerId === user.id && ride.delivery, 'NOT_FOUND', 'Parcel not found.');
    return ride;
  }
  function linkView(row) {
    return row ? { id: row.id, version: row.version, active: Boolean(row.active && row.intendedEmailHash && (row.recipientId || clock() < row.expiresAt)),
      expiresAt: row.expiresAt, claimed: Boolean(row.recipientId) } : null;
  }
  async function invitation(ride, row) {
    return { invitation: { rideId: ride.rideId, canCreate: !terminal.has(ride.status),
      link: linkView(row === undefined ? await repository.latest(ride.rideId) : row) } };
  }
  async function snapshot(user, row) {
    if (!row?.active || row.recipientId !== user.id || !recipientMatches(user, row)) unavailable();
    const sender = await getAccount(row.ownerId);
    if (!sender) unavailable();
    const ride = await owned(sender, row.rideId);
    if (ride.customerId === user.id || ride.driverId === user.id) unavailable();
    const moving = ride.status === 'in_progress';
    const location = moving ? await locationForTrip(ride.rideId) : null;
    // Explicit projection excludes pickup addresses, phone numbers, fares, and sender/driver account IDs.
    return { rideId: ride.rideId, reference: `PARCEL-${ride.rideId.slice(0, 8).toUpperCase()}`,
      status: ride.status, description: ride.delivery.description, weightKg: ride.delivery.weightKg,
      recipientName: ride.delivery.recipientName, destination: ride.destination,
      driver: ride.driver ? { name: ride.driver.name, vehicle: ride.driver.vehicle } : null,
      location: location && !location.stale ? { lat: location.lat, lng: location.lng, accuracy: location.accuracy,
        capturedAt: location.capturedAt, source: 'driver_shared', stale: false } : null,
      dropoffPin: moving ? ride.delivery.dropoffPin ?? null : null,
      verifiedAt: ride.delivery.verifiedAt ?? null, updatedAt: ride.updatedAt };
  }
  async function get(userId, rideId) {
    return await unitOfWork(async () => invitation(await owned(await actor(userId), rideId)));
  }
  async function received(userId, rideId) {
    return await unitOfWork(async () => {
      const user = await actor(userId);
      check(identifier(rideId), 'NOT_FOUND', 'Parcel not found.');
      return { parcel: await snapshot(user, await repository.received(userId, rideId)) };
    });
  }
  async function list(userId) {
    return await unitOfWork(async () => {
      const user = await actor(userId), parcels = [];
      for (const row of await repository.listReceived(userId)) {
        if (recipientMatches(user, row)) parcels.push(await snapshot(user, row));
      }
      return { parcels };
    });
  }
  async function command({ userId, rideId = null, action, data, key }) {
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const fingerprint = tokens.digest(canonical({ rideId, action, data }));
    return await unitOfWork(async () => {
      const user = await actor(userId), previous = await repository.command(userId, key), now = clock();
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This request key belongs to another parcel action.');
        const row = await repository.link(previous.linkId);
        return action === 'accept' ? { parcel: await snapshot(user, row), replayed: true }
          : { ...await invitation(await owned(user, rideId)), replayed: true };
      }
      if (action === 'accept') {
        fields(data, ['token']);
        if (typeof data.token !== 'string' || !/^[a-f0-9]{64}$/.test(data.token)) unavailable();
        const row = await repository.byToken(tokens.digest(data.token));
        if (!row || row.recipientId && row.recipientId !== user.id || !row.recipientId && now >= row.expiresAt) unavailable();
        check(user.emailVerified, 'FORBIDDEN', 'Verify your Taxi Ai account email before accepting a parcel invitation.');
        if (!recipientMatches(user, row)) unavailable();
        const sender = await getAccount(row.ownerId);
        if (!sender) unavailable();
        const ride = await owned(sender, row.rideId);
        if (ride.customerId === user.id || ride.driverId === user.id || !row.recipientId && terminal.has(ride.status)) unavailable();
        if (!row.recipientId) {
          check(await repository.claim(row.id, user.id, now), 'STALE_VERSION', 'This invitation changed. Ask the sender for a new invitation.');
          await audit.record(user.id, 'parcel.recipient.accepted', row.id, now);
        }
        await repository.saveCommand(user.id, key, fingerprint, row.id);
        return { parcel: await snapshot(user, await repository.link(row.id)), replayed: false };
      }
      const ride = await owned(user, rideId), current = await repository.latest(rideId);
      let linkId, token;
      if (action === 'link') {
        check(data && Object.hasOwn(data, 'recipientEmail'), 'INVALID_CLIENT_VERSION', 'Update the Taxi Ai app or use the current website to enter the intended recipient email before creating an invitation.');
        fields(data, ['expectedLinkId', 'recipientEmail']);
        const intendedEmail = emailAddress(data.recipientEmail);
        check(data.expectedLinkId === null || identifier(data.expectedLinkId), 'INVALID_INPUT', 'Use the parcel invitation currently shown.');
        check(!terminal.has(ride.status), 'LINK_CLOSED', 'This parcel delivery has ended.');
        check((current?.id ?? null) === data.expectedLinkId, 'STALE_VERSION', 'The parcel invitation changed. Refresh before replacing it.');
        check(await repository.count(rideId) < 30, 'LINK_LIMIT', 'This parcel has reached its invitation limit.');
        if (current?.active) await repository.end(current.id, now, 'replaced');
        linkId = tokens.id(); token = tokens.generate();
        await repository.add({ id: linkId, rideId, ownerId: user.id, tokenHash: tokens.digest(token),
          intendedEmailHash: emailHash(intendedEmail, linkId), now, expiresAt: now + 86_400_000 });
      } else if (action === 'revoke') {
        fields(data, ['linkId', 'expectedVersion']);
        check(identifier(data.linkId) && Number.isSafeInteger(data.expectedVersion) && data.expectedVersion >= 0, 'INVALID_INPUT', 'Use the current invitation and version.');
        check(current?.id === data.linkId && current.version === data.expectedVersion, 'STALE_VERSION', 'The parcel invitation changed. Refresh before revoking it.');
        check(current.active, 'LINK_CLOSED', 'This parcel invitation has already ended.');
        await repository.end(current.id, now, 'revoked'); linkId = current.id;
      } else check(false, 'NOT_FOUND', 'Parcel action not found.');
      await repository.saveCommand(user.id, key, fingerprint, linkId);
      await audit.record(user.id, `parcel.${action}`, linkId, now);
      return { ...await invitation(ride, await repository.link(linkId)), replayed: false, ...(token ? { token } : {}) };
    });
  }
  async function preview(data) {
    fields(data, ['token']);
    if (typeof data.token !== 'string' || !/^[a-f0-9]{64}$/.test(data.token)) unavailable();
    return unitOfWork(async () => {
      const row = await repository.byToken(tokens.digest(data.token));
      if (!row?.intendedEmailHash || clock() >= row.expiresAt) unavailable();
      const owner = await getAccount(row.ownerId);
      if (!owner) unavailable();
      const ride = await owned(owner, row.rideId);
      // A capability grants only this coarse status before verified account acceptance.
      // No name, address, driver, exact location or handover code is returned.
      return { preview: { reference: `PARCEL-${ride.rideId.slice(0, 8).toUpperCase()}`,
        status: ride.status, updatedAt: ride.updatedAt, requiresVerifiedAccount: true } };
    });
  }
  return Object.freeze({ get, received, list, command, preview,
    isRecipient: async (userId, rideId) => Boolean(await repository.received(userId, rideId)) });
}
