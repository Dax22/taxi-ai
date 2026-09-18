import { createDemoQuote } from '../../../../../packages/shared/src/demo-booking.mjs';
import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { requireRole } from '../../shared/policies.mjs';
import { requireParticipant, requireVersion, restoreNegotiation, canonical } from './domain.mjs';

/**
 * Ride use cases depend on repository operations and explicit ports, not SQLite
 * or HTTP objects. unitOfWork must encompass state, fare, audit and retry writes.
 */
export function createRidesService({ repository, getAccount, unitOfWork, audit, tokens, clock }) {
  function record(id) {
    const ride = repository.find(id);
    check(ride, 'NOT_FOUND', 'Ride request not found.');
    return ride;
  }

  function negotiationFor(ride) {
    return restoreNegotiation(ride, ride.driverId ? repository.listFareEvents(ride.id) : []);
  }

  function peer(id, driver = false) {
    if (!id) return null;
    const user = getAccount(id);
    return { id: user.id, name: user.name, ...(driver ? { vehicle: user.driver.vehicle } : {}) };
  }

  function view(ride) {
    const quote = createDemoQuote(ride.pickupId, ride.destinationId);
    return { id: ride.id, status: ride.status, version: ride.version,
      pickup: quote.pickup, destination: quote.destination, suggestedFareKobo: ride.suggestedFareKobo,
      currency: 'NGN', isDemo: true, createdAt: ride.createdAt, updatedAt: ride.updatedAt,
      customer: peer(ride.customerId), driver: peer(ride.driverId, true),
      negotiation: negotiationFor(ride)?.snapshot() ?? null };
  }

  function get(user, id) {
    const ride = record(id);
    requireParticipant(ride, user);
    return view(ride);
  }

  function list(user) {
    const available = user.role === 'driver' && user.driver.status === 'approved' ? repository.listAvailable() : [];
    return { rides: repository.listFor(user.id).map(view), available: available.map((ride) => {
      const quote = createDemoQuote(ride.pickupId, ride.destinationId);
      return { id: ride.id, version: ride.version, pickup: quote.pickup, destination: quote.destination,
        suggestedFareKobo: ride.suggestedFareKobo, currency: 'NGN', isDemo: true, createdAt: ride.createdAt };
    }) };
  }

  function create(user, data, now) {
    requireRole(user, 'customer');
    fields(data, ['pickupId', 'destinationId']);
    let quote;
    try { quote = createDemoQuote(data.pickupId, data.destinationId); }
    catch (error) { check(false, 'INVALID_ROUTE', error.message); }
    check(!repository.hasOpenRequest(user.id), 'OPEN_REQUEST_EXISTS', 'You already have an open request. Finish or cancel it first.');
    const id = tokens.id();
    repository.insert({ id, customerId: user.id, pickupId: quote.pickup.id,
      destinationId: quote.destination.id, suggestedFareKobo: quote.suggestedFareKobo, now });
    audit.record(user.id, 'ride.requested', id, now);
    return id;
  }

  function claim(user, id, data, now) {
    requireRole(user, 'driver');
    fields(data, ['expectedVersion']);
    const ride = record(id);
    check(ride.status === 'requested', 'REQUEST_UNAVAILABLE', 'Another driver took this request, or it is no longer open.');
    requireVersion(ride, data.expectedVersion);
    check(!repository.hasNegotiation(user.id), 'DRIVER_BUSY', 'Finish or cancel your current negotiation first.');
    check(repository.claim({ id, driverId: user.id, expectedVersion: ride.version, now }),
      'STALE_VERSION', 'This request has changed. Refresh and try again.');
    audit.record(user.id, 'ride.claimed', id, now);
    return id;
  }

  function changeFare(user, id, action, data, now) {
    check(['propose', 'accept', 'cancel'].includes(action), 'NOT_FOUND', 'Action not found.');
    fields(data, action === 'propose' ? ['expectedVersion', 'amountKobo']
      : action === 'accept' ? ['expectedVersion', 'offerId'] : ['expectedVersion']);
    const ride = record(id);
    requireParticipant(ride, user);
    if (user.role === 'driver') requireRole(user, 'driver');
    requireVersion(ride, data.expectedVersion);
    check(['requested', 'negotiating'].includes(ride.status), 'REQUEST_CLOSED', 'This request has already ended.');
    let status;
    if (ride.status === 'requested') {
      check(action === 'cancel', 'NO_DRIVER', 'Wait for a driver before negotiating a fare.');
      status = 'cancelled';
    } else {
      const negotiation = negotiationFor(ride);
      const current = negotiation.snapshot();
      check(action !== 'propose' || current.offers.length < 100,
        'OFFER_LIMIT', 'This request has reached its offer limit. Accept the current offer or cancel.');
      const payload = { actorId: user.id, expectedVersion: current.version, now };
      if (action === 'propose') Object.assign(payload, { amountKobo: data.amountKobo, channel: 'in_app', validForMs: 120_000 });
      if (action === 'accept') payload.offerId = data.offerId;
      const next = negotiation[action](payload);
      status = next.status === 'open' ? 'negotiating' : next.status;
      repository.appendFareEvent(id, next.version, action, payload);
    }
    check(repository.updateState({ id, status, expectedVersion: ride.version, now }),
      'STALE_VERSION', 'This request has changed. Refresh and try again.');
    audit.record(user.id, `fare.${action}`, id, now);
    return id;
  }

  function mutate({ userId, key, action, id = null, data }) {
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key),
      'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const fingerprint = tokens.digest(canonical({ action, id, data }));
    return unitOfWork(() => {
      const user = getAccount(userId);
      check(user, 'UNAUTHENTICATED', 'Sign in to continue.');
      const previous = repository.findCommand(userId, key);
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This request key was already used for another action.');
        return { ride: get(user, previous.rideId), replayed: true };
      }
      const now = clock();
      const rideId = action === 'create' ? create(user, data, now)
        : action === 'claim' ? claim(user, id, data, now) : changeFare(user, id, action, data, now);
      repository.saveCommand(userId, key, fingerprint, rideId);
      return { ride: get(user, rideId), replayed: false };
    });
  }

  return Object.freeze({ get, list, mutate });
}
