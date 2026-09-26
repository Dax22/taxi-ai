import { createDemoQuote } from '../../../../../packages/shared/src/demo-booking.mjs';
import { TRIP_TRANSITIONS, CANCELLATION_REASONS, canCancelRide } from '../../../../../packages/shared/src/trip-lifecycle.mjs';
import { distanceMeters } from '../../../../../packages/shared/src/locations.mjs';
import { transportCategory, categoryFare } from '../../../../../packages/shared/src/transport-categories.mjs';
import { REQUEST_MS, EXPAND_MS, searchRadius } from '../../../../../packages/shared/src/matching.mjs';
import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { hasCapability, requireRole, requireEligibleDriver } from '../../shared/policies.mjs';
import { requireParticipant, requireVersion, restoreNegotiation, canonical } from './domain.mjs';

/**
 * Ride use cases depend on repository operations and explicit ports, not SQLite
 * or HTTP objects. unitOfWork must encompass state, fare, audit and retry writes.
 */
export function createRidesService({ repository, deliveries, getAccount, unitOfWork, audit, tokens, clock, onRideClosed = () => {}, onTripCompleted = () => {},
  routeForRide = () => null, quoteForRide, bindQuote, availabilityFor = () => null, onClaim = () => {}, onEvent = () => {}, availableDriverIds = () => [], driverPhotoFor = () => null, allowSimulation = false }) {
  // Expiry commits independently of a command that may fail afterward.
  function sweep() {
    unitOfWork(() => {
      const now = clock();
      for (const ride of repository.expiring(now)) {
        repository.expire(ride.id, now);
        audit.record(ride.customerId, 'ride.request_expired', ride.id, now);
        onEvent({ kind: 'expired', ride, actorId: null, eventKey: `expired:${ride.id}`, now });
      }
    });
  }
  function record(id) {
    const ride = repository.find(id);
    check(ride, 'NOT_FOUND', 'Ride request not found.');
    return { ...ride, trip: repository.findTrip(id) };
  }

  function negotiationFor(ride) {
    return restoreNegotiation(ride, ride.driverId ? repository.listFareEvents(ride.id) : []);
  }

  function peer(id, driver = false) {
    if (!id) return null;
    const user = getAccount(id);
    return { id: user.id, name: user.name, ...(driver ? { vehicle: user.driver.vehicle } : {}) };
  }

  function view(ride, user) {
    const route = routeForRide(ride.id);
    const quote = route ?? createDemoQuote(ride.pickupId, ride.destinationId);
    const trip = ride.trip ?? repository.findTrip(ride.id);
    return { id: ride.id, status: trip?.status ?? (ride.closedReason === 'request_expired' ? 'expired' : ride.status), version: ride.version,
      pickup: quote.pickup, destination: quote.destination, suggestedFareKobo: ride.suggestedFareKobo,
      currency: 'NGN', isDemo: true, route, vehicleCategory: ride.vehicleCategory, service: transportCategory(ride.vehicleCategory).service,
      delivery: deliveries.view(ride, user, trip?.status ?? ride.status), createdAt: ride.createdAt, updatedAt: ride.updatedAt,
      customer: peer(ride.customerId), driver: ride.driverSnapshotJson ? JSON.parse(ride.driverSnapshotJson) : peer(ride.driverId, true),
      negotiation: negotiationFor(ride)?.snapshot() ?? null,
      matching: ride.requestExpiresAt ? { expiresAt: ride.requestExpiresAt, expandedAt: ride.createdAt + EXPAND_MS,
        radiusMeters: route ? searchRadius(ride.createdAt, ride.matchedAt ?? (ride.closedReason ? ride.updatedAt : clock())) : null,
        mode: route ? 'gps' : 'sample', reason: ride.closedReason } : null,
      trip: trip ? { status: trip.status, fareKobo: trip.fareKobo, bookedAt: trip.bookedAt,
        departedAt: trip.departedAt, arrivedAt: trip.arrivedAt, startedAt: trip.startedAt, completedAt: trip.completedAt,
        pinBlockedUntil: trip.pinBlockedUntil,
        ...(user.id === ride.customerId && trip.pickupPin ? { pickupPin: trip.pickupPin } : {}) } : null,
      activity: repository.activity(ride.id) };
  }

  function get(user, id) {
    sweep();
    const ride = record(id);
    requireParticipant(ride, user);
    return view(ride, user);
  }

  function driverPhoto(user, id) {
    sweep();
    const ride = record(id);
    requireParticipant(ride, user);
    check(ride.driverId, 'NOT_FOUND', 'Driver profile photo is not available before a driver is assigned.');
    const photo = driverPhotoFor(ride.driverId);
    check(photo, 'NOT_FOUND', 'Approved driver profile photo is unavailable.');
    return { driverId: ride.driverId, mimeType: photo.mimeType, base64: photo.base64 };
  }

  function requireMode(user, mode) {
    check(mode === null || ['customer', 'work'].includes(mode), 'INVALID_MODE', 'Choose Customer or Work.');
    if (mode) check(hasCapability(user, mode === 'work' ? 'driver' : 'customer'), 'FORBIDDEN', 'This account does not have that capability.');
  }
  const inMode = (ride, user, mode) => !mode || (mode === 'work' ? ride.driverId : ride.customerId) === user.id;

  function list(user, mode = null) {
    requireMode(user, mode);
    sweep();
    const position = mode !== 'customer' && hasCapability(user, 'driver') && user.driver?.status === 'approved' ? availabilityFor(user.id, clock()) : null;
    const available = position ? repository.listAvailable().filter((ride) => ride.customerId !== user.id && deliveries.matches(ride, user.driver.vehicle)).map((ride) => ({ ride, metres: matchDistance(ride, position, clock()) }))
      .filter((item) => item.metres !== null).sort((a, b) => a.metres - b.metres || a.ride.createdAt - b.ride.createdAt || a.ride.id.localeCompare(b.ride.id)).slice(0, 50) : [];
    return { matchingSettings: { allowSimulation },
      activeElsewhere: repository.activeFor(user.id).filter((ride) => !inMode(ride, user, mode)).map((ride) => ({
        id: ride.id, mode: ride.customerId === user.id ? 'customer' : 'work', status: repository.findTrip(ride.id)?.status ?? ride.status })),
      rides: repository.listFor(user.id, mode).map((ride) => view(ride, user)), available: available.map(({ ride, metres }) => {
      const route = routeForRide(ride.id);
      const area = (point) => ({ name: `Near ${point.lat.toFixed(2)}, ${point.lng.toFixed(2)} (approximate area)` });
      const quote = route ? { pickup: area(route.pickup), destination: area(route.destination) }
        : createDemoQuote(ride.pickupId, ride.destinationId);
      return { id: ride.id, version: ride.version, vehicleCategory: ride.vehicleCategory, service: transportCategory(ride.vehicleCategory).service, pickup: quote.pickup, destination: quote.destination,
        suggestedFareKobo: ride.suggestedFareKobo, currency: 'NGN', isDemo: true, hasRoute: Boolean(route), createdAt: ride.createdAt,
        expiresAt: ride.requestExpiresAt, approximateDistanceKm: route ? Math.ceil(metres / 1000) : null };
    }) };
  }

  function matchDistance(ride, availability, now) {
    if (ride.status !== 'requested' || now >= ride.requestExpiresAt) return null;
    const route = routeForRide(ride.id);
    if (!route) return availability.mode === 'sample' && availability.areaId === ride.pickupId ? 0 : null;
    if (availability.mode !== 'gps') return null;
    const metres = distanceMeters(availability.position, route.pickup);
    return metres <= searchRadius(ride.createdAt, now) ? metres : null;
  }

  function history(user, beforeId = null, mode = null) {
    requireMode(user, mode);
    sweep();
    let before = null;
    if (beforeId !== null) {
      check(typeof beforeId === 'string' && /^[a-f0-9-]{36}$/.test(beforeId), 'INVALID_CURSOR', 'Invalid history cursor.');
      before = record(beforeId);
      requireParticipant(before, user);
      check(inMode(before, user, mode), 'INVALID_CURSOR', 'This history cursor belongs to another mode.');
      check(before.status === 'cancelled' || before.trip?.status === 'completed', 'INVALID_CURSOR', 'Use a completed, cancelled or expired journey as the cursor.');
    }
    const rows = repository.history(user.id, before, 21, mode);
    const page = rows.slice(0, 20);
    return { rides: page.map((ride) => view(ride, user)), nextBefore: rows.length > 20 ? page.at(-1).id : null };
  }

  function create(user, data, now) {
    requireRole(user, 'customer');
    const routed = Boolean(data && Object.hasOwn(data, 'quoteId'));
    const required = routed ? ['quoteId'] : ['pickupId', 'destinationId'];
    fields(data, [...required, 'vehicleCategory', 'delivery'], required);
    const category = data.vehicleCategory === undefined ? 'standard' : data.vehicleCategory;
    check(transportCategory(category), 'INVALID_CATEGORY', 'Choose a vehicle category.');
    const delivery = deliveries.validate(category, data.delivery);
    let quote;
    if (routed) {
      check(typeof data.quoteId === 'string' && /^[a-f0-9-]{36}$/.test(data.quoteId), 'INVALID_ROUTE', 'Preview a route before requesting a ride.');
      quote = quoteForRide(user.id, data.quoteId, now);
      check((quote.vehicleCategory ?? 'standard') === category, 'QUOTE_CATEGORY_MISMATCH', 'Preview this category again before booking.');
    } else {
      check(allowSimulation, 'FORBIDDEN', 'Sample requests are available only in local development. Use a route preview for hosted testing.');
      try { quote = createDemoQuote(data.pickupId, data.destinationId); quote.suggestedFareKobo = categoryFare(quote.suggestedFareKobo, category); }
      catch (error) { check(false, 'INVALID_ROUTE', error.message); }
    }
    check(!repository.hasOpenRequest(user.id), 'OPEN_REQUEST_EXISTS', 'You already have an open request. Finish or cancel it first.');
    check(!repository.hasDriverWork(user.id), 'DRIVER_BUSY', 'Finish or cancel your assigned work before requesting a personal ride.');
    check(!availabilityFor(user.id, now), 'DRIVER_ONLINE', 'Go offline from Work before requesting a personal ride.');
    const id = tokens.id();
    repository.insert({ id, customerId: user.id, pickupId: quote.pickup.id,
      destinationId: quote.destination.id, suggestedFareKobo: quote.suggestedFareKobo, vehicleCategory: category, now, expiresAt: now + REQUEST_MS });
    deliveries.create(id, delivery);
    if (routed) bindQuote(user.id, data.quoteId, id, now);
    audit.record(user.id, 'ride.requested', id, now);
    return id;
  }

  function claim(user, id, data, now) {
    requireEligibleDriver(user);
    fields(data, ['expectedVersion']);
    const ride = record(id);
    check(ride.customerId !== user.id, 'FORBIDDEN', 'You cannot drive your own request.');
    check(deliveries.matches(ride, user.driver.vehicle), 'VEHICLE_MISMATCH', 'This request needs a different approved vehicle category or load capacity.');
    check(ride.status === 'requested', 'REQUEST_UNAVAILABLE', 'Another driver took this request, or it is no longer open.');
    requireVersion(ride, data.expectedVersion);
    check(!repository.hasNegotiation(user.id), 'DRIVER_BUSY', 'Finish your current negotiation or trip first.');
    check(!repository.hasCustomerWork(user.id, now), 'CUSTOMER_BUSY', 'Finish or cancel your personal journey before accepting work.');
    const availability = availabilityFor(user.id, now);
    check(availability, 'DRIVER_OFFLINE', 'Go online with a fresh location before selecting a request.');
    check(matchDistance(ride, availability, now) !== null, 'OUTSIDE_MATCH_AREA', 'This request is outside your current matching area. Refresh nearby requests.');
    check(repository.claim({ id, driverId: user.id, driverSnapshot: peer(user.id, true), expectedVersion: ride.version, now }),
      'STALE_VERSION', 'This request has changed. Refresh and try again.');
    audit.record(user.id, 'ride.claimed', id, now);
    onClaim(user.id, now);
    return id;
  }

  function changeFare(user, id, action, data, now) {
    check(['propose', 'accept'].includes(action), 'NOT_FOUND', 'Action not found.');
    fields(data, action === 'propose' ? ['expectedVersion', 'amountKobo']
      : ['expectedVersion', 'offerId']);
    const ride = record(id);
    requireParticipant(ride, user);
    if (ride.driverId === user.id) requireRole(user, 'driver');
    requireVersion(ride, data.expectedVersion);
    check(['requested', 'negotiating'].includes(ride.status), 'REQUEST_CLOSED', 'This request has already ended.');
    check(ride.status === 'negotiating', 'NO_DRIVER', 'Wait for a driver before negotiating a fare.');
    const negotiation = negotiationFor(ride);
    const current = negotiation.snapshot();
    check(action !== 'propose' || current.offers.length < 100,
      'OFFER_LIMIT', 'This request has reached its offer limit. Accept the current offer or cancel.');
    const payload = { actorId: user.id, expectedVersion: current.version, now };
    if (action === 'propose') Object.assign(payload, { amountKobo: data.amountKobo, channel: 'in_app', validForMs: 120_000 });
    if (action === 'accept') payload.offerId = data.offerId;
    const next = negotiation[action](payload);
    const status = next.status === 'open' ? 'negotiating' : next.status;
    repository.appendFareEvent(id, next.version, action, payload);
    check(repository.updateState({ id, status, expectedVersion: ride.version, now }),
      'STALE_VERSION', 'This request has changed. Refresh and try again.');
    audit.record(user.id, `fare.${action}`, id, now);
    return id;
  }

  function changeTrip(user, id, action, data, now) {
    fields(data, action === 'start' ? ['expectedVersion', 'pickupPin']
      : action === 'cancel' ? ['expectedVersion', 'reason'] : action === 'complete' ? ['expectedVersion', 'deliveryPin'] : ['expectedVersion'],
    action === 'start' ? ['expectedVersion', 'pickupPin'] : ['expectedVersion']);
    const ride = record(id);
    requireParticipant(ride, user);
    if (ride.driverId === user.id) requireRole(user, 'driver');
    requireVersion(ride, data.expectedVersion);
    const status = ride.trip?.status ?? ride.status;
    let next;
    let reason = null;
    if (action === 'confirm') {
      requireRole(user, 'customer');
      check(ride.customerId === user.id, 'FORBIDDEN', 'Only the passenger on this trip can confirm it.');
      check(ride.status === 'agreed' && !ride.trip, 'INVALID_TRIP_STATE', 'An agreed fare is required before confirming this booking.');
      const driver = getAccount(ride.driverId);
      requireEligibleDriver(driver);
      check(deliveries.matches(ride, driver.driver.vehicle), 'VEHICLE_MISMATCH', 'The approved vehicle no longer matches this request.');
      check(!repository.hasOpenRequest(user.id), 'OPEN_REQUEST_EXISTS', 'Finish or cancel your other request or trip before confirming.');
      check(!repository.hasNegotiation(ride.driverId), 'DRIVER_BUSY', 'This driver has another negotiation or trip. Ask them to finish it before confirming.');
      check(!repository.hasDriverWork(user.id), 'DRIVER_BUSY', 'Finish your assigned work before confirming a personal ride.');
      check(!repository.hasCustomerWork(ride.driverId, now), 'CUSTOMER_BUSY', 'This driver has a personal journey to finish before taking work.');
      check(!availabilityFor(user.id, now), 'DRIVER_ONLINE', 'Go offline from Work before confirming a personal ride.');
      const agreement = negotiationFor(ride).snapshot().agreement;
      check(agreement, 'INVALID_TRIP_STATE', 'Both participants must agree the fare first.');
      repository.bookTrip({ ride, fareKobo: agreement.amountKobo, pin: tokens.pickupPin(), now });
      deliveries.confirm(id);
      next = 'booked';
    } else if (action === 'cancel') {
      check(canCancelRide(status), 'REQUEST_CLOSED', 'Only a request or a trip that has not started can be cancelled.');
      reason = data.reason ?? 'other';
      check(typeof reason === 'string' && Object.hasOwn(CANCELLATION_REASONS, reason), 'INVALID_REASON', 'Choose a cancellation reason.');
      if (ride.status === 'negotiating') {
        const negotiation = negotiationFor(ride);
        const payload = { actorId: user.id, expectedVersion: negotiation.snapshot().version, now };
        const cancelled = negotiation.cancel(payload);
        repository.appendFareEvent(id, cancelled.version, 'cancel', payload);
      }
      if (ride.trip) repository.updateTrip(id, 'cancelled', now);
      deliveries.cancel(id);
      next = 'cancelled';
    } else {
      requireRole(user, 'driver');
      check(ride.driverId === user.id, 'FORBIDDEN', 'Only the assigned driver can operate this trip.');
      const transition = TRIP_TRANSITIONS[action];
      check(transition && status === transition.from, 'INVALID_TRIP_STATE', 'This trip action is not available at the current stage.');
      if (action === 'start') {
        requireEligibleDriver(user);
        check(deliveries.matches(ride, user.driver.vehicle), 'VEHICLE_MISMATCH', 'The approved vehicle no longer matches this request.');
        check(typeof data.pickupPin === 'string' && /^\d{6}$/.test(data.pickupPin), 'INVALID_PIN_FORMAT', 'Enter the customer’s six-digit pickup PIN.');
        const trip = ride.trip;
        check(!trip.pinBlockedUntil || trip.pinBlockedUntil <= now, 'PICKUP_PIN_LOCKED', 'Too many incorrect PINs. Wait five minutes from the last failed attempt before trying again.');
        if (!tokens.equal(data.pickupPin, trip.pickupPin)) {
          const failures = (trip.pinBlockedUntil && trip.pinBlockedUntil <= now ? 0 : trip.pinFailures) + 1;
          repository.failPin(id, failures, failures >= 5 ? now + 5 * 60_000 : null);
          // Do not throw inside the transaction: failure counters and retry keys must persist.
          audit.record(user.id, 'trip.pin_rejected', id, now);
          return { rideId: id, errorCode: 'INVALID_PICKUP_PIN' };
        }
      }
      if (action === 'complete') {
        const delivery = transportCategory(ride.vehicleCategory).service === 'delivery';
        check(delivery || data.deliveryPin === undefined, 'INVALID_FIELDS', 'Passenger trips do not use a drop-off code.');
        if (delivery && !deliveries.verify(id, data.deliveryPin, now)) {
          audit.record(user.id, 'delivery.pin_rejected', id, now);
          return { rideId: id, errorCode: 'INVALID_DELIVERY_PIN' };
        }
      }
      next = transition.to;
      repository.updateTrip(id, next, now);
    }
    check(repository.updateState({ id, status: next === 'cancelled' ? 'cancelled' : 'agreed', expectedVersion: ride.version, now }),
      'STALE_VERSION', 'This trip has changed. Refresh and try again.');
    repository.appendActivity(id, user.id, next, now, reason);
    audit.record(user.id, `trip.${next}`, id, now);
    if (next === 'completed') onTripCompleted({ rideId: id, customerId: ride.customerId,
      driverId: ride.driverId, amountKobo: ride.trip.fareKobo, completedAt: now });
    if (['completed', 'cancelled'].includes(next)) onRideClosed(id, now);
    return { rideId: id };
  }

  function mutate({ userId, key, action, id = null, data }) {
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key),
      'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const fingerprint = tokens.digest(canonical({ action, id, data }));
    sweep();
    const result = unitOfWork(() => {
      const user = getAccount(userId);
      check(user, 'UNAUTHENTICATED', 'Sign in to continue.');
      const previous = repository.findCommand(userId, key);
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This request key was already used for another action.');
        requireParticipant(record(previous.rideId), user);
        if (record(previous.rideId).driverId === user.id) requireRole(user, 'driver');
        return previous.errorCode ? { errorCode: previous.errorCode }
          : { ride: view(record(previous.rideId), user), replayed: true };
      }
      const now = clock();
      const tripAction = ['confirm', 'depart', 'arrive', 'start', 'complete', 'cancel'].includes(action);
      const outcome = tripAction ? changeTrip(user, id, action, data, now) : { rideId:
        action === 'create' ? create(user, data, now) : action === 'claim' ? claim(user, id, data, now)
          : changeFare(user, id, action, data, now) };
      repository.saveCommand(userId, key, fingerprint, outcome.rideId, outcome.errorCode);
      if (!outcome.errorCode) {
        const ride = record(outcome.rideId);
        const recipients = action === 'create' ? availableDriverIds().filter((driverId) => {
          const driver = getAccount(driverId), position = availabilityFor(driverId, now);
          return driverId !== userId && driver?.driver && position && deliveries.matches(ride, driver.driver.vehicle) && matchDistance(ride, position, now) !== null;
        }) : [];
        onEvent({ kind: action === 'create' ? 'request' : action, ride, actorId: userId, recipients, eventKey: `ride:${ride.id}:${ride.version}`, now });
      }
      return outcome.errorCode ? outcome : { ride: view(record(outcome.rideId), user), replayed: false };
    });
    check(!result.errorCode, result.errorCode, result.errorCode === 'INVALID_DELIVERY_PIN'
      ? 'The drop-off code is incorrect. Ask the recipient to check it. After five incorrect attempts, verification pauses for five minutes.'
      : 'The pickup PIN is incorrect. Ask the customer to check it. After five incorrect attempts, verification pauses for five minutes.');
    return result;
  }

  // Narrow read ports for communication: no fare replay or peer-profile loading.
  function conversationContext(user, id) {
    const ride = record(id);
    requireParticipant(ride, user);
    return { id: ride.id, status: ride.trip?.status ?? ride.status, driverId: ride.driverId, customerId: ride.customerId };
  }

  function conversationIds(user) {
    return repository.listFor(user.id).filter((ride) => ride.driverId).map((ride) => ride.id);
  }

  function paymentContext(user, id) {
    const ride = record(id);
    requireParticipant(ride, user);
    const route = routeForRide(id) ?? createDemoQuote(ride.pickupId, ride.destinationId);
    return { rideId: id, customerId: ride.customerId, driverId: ride.driverId,
      status: ride.trip?.status ?? ride.status, amountKobo: ride.trip?.fareKobo ?? null,
      completedAt: ride.trip?.completedAt ?? null, pickup: route.pickup.name, destination: route.destination.name };
  }

  function safetyContext(user, id) {
    const ride = record(id); requireParticipant(ride, user);
    const route = routeForRide(id) ?? createDemoQuote(ride.pickupId, ride.destinationId);
    return { rideId: id, customerId: ride.customerId, driverId: ride.driverId, status: ride.trip?.status ?? ride.status, pickup: route.pickup.name, destination: route.destination.name,
      driver: ride.driverSnapshotJson ? JSON.parse(ride.driverSnapshotJson) : peer(ride.driverId, true) };
  }
  return Object.freeze({ get, list, history, mutate, conversationContext, conversationIds, paymentContext, safetyContext, sweep, driverPhoto });
}
