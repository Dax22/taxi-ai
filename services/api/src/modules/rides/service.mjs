import { createDemoQuote } from '../../../../../packages/shared/src/demo-booking.mjs';
import { TRIP_TRANSITIONS, CANCELLATION_REASONS, canCancelRide } from '../../../../../packages/shared/src/trip-lifecycle.mjs';
import { distanceMeters } from '../../../../../packages/shared/src/locations.mjs';
import { transportCategory, categoryFare } from '../../../../../packages/shared/src/transport-categories.mjs';
import { passengerDetails, passengerView } from '../../../../../packages/shared/src/guest-rides.mjs';
import { REQUEST_MS, EXPAND_MS, searchRadius } from '../../../../../packages/shared/src/matching.mjs';
import { rankEligibleMatches } from '../../../../../packages/shared/src/smart-matching.mjs';
import { DISPATCH_POLICY } from '../../../../../packages/shared/src/dispatch.mjs';
import { dispatchRegion } from '../../shared/dispatch-region.mjs';
import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { hasCapability, requireRole, requireEligibleDriver } from '../../shared/policies.mjs';
import { requireParticipant, requireVersion, restoreNegotiation, canonical } from './domain.mjs';
import { asyncFilter, asyncMap, asyncFlatMap } from '../../shared/async-collections.mjs';
import { createRidePilotConfig } from '../../../../../packages/shared/src/ride-pilot.mjs';
import { matchingPairKey } from '../../shared/matching-pair-key.mjs';


/**
 * Ride use cases depend on repository operations and explicit ports, not SQLite
 * or HTTP objects. unitOfWork must encompass state, fare, audit and retry writes.
 */
export function createRidesService({ repository, deliveries, passengerForRide, savePassenger, getAccount, unitOfWork, audit, tokens, clock, onRideClosed = () => {}, onTripCompleted = () => {},
  requireTripLocation = () => check(false, 'TRIP_LOCATION_REQUIRED', 'Share a fresh location from your working device before progressing this trip.'),
  checkoutPayments = null,
  routeForRide = () => null, quoteForRide, bindQuote, availabilityFor = () => null, onClaim = () => {}, onEvent = () => {}, availableDriverIds = () => [], nearbyDriverIds = null, hasOtherWork = () => false, allowSimulation = false,
  dispatch = null, isParcelRecipient = async () => false, ridePilot = createRidePilotConfig(), matching = null, nearbyMatchingDriverIds = null }) {
  const checkoutEnabled = checkoutPayments?.enabled === true;
  if (checkoutEnabled && (typeof checkoutPayments.requirePaid !== 'function' || typeof checkoutPayments.close !== 'function'))
    throw new Error('Enabled ride checkout requires verified-payment and cancellation ports.');
  // Expiry commits independently of a command that may fail afterward.
  async function expireRequested(ride, now) {
    if (!ride || ride.status !== 'requested' || now < ride.requestExpiresAt) return;
    if (!await repository.expire(ride.id, now)) return;
    await audit.record(ride.customerId, 'ride.request_expired', ride.id, now);
    await onEvent({ kind: 'expired', ride, actorId: null, eventKey: `expired:${ride.id}`, now });
  }
  async function sweep() {
    await unitOfWork(async () => {
      const now = clock();
      for (const ride of await repository.expiring(now)) await expireRequested(ride, now);
    });
  }
  async function expireTarget(userId, rideId = null) {
    await unitOfWork(async () => {
      const now = clock();
      const rows = rideId ? [await repository.find(rideId)] : await repository.expiringForUser(userId, now);
      for (const ride of rows) await expireRequested(ride, now);
    });
  }
  async function record(id) {
    const ride = (await repository.find(id));
    check(ride, 'NOT_FOUND', 'Ride request not found.');
    return { ...ride, trip: (await repository.findTrip(id)) };
  }

  // The confirmed trip row, never a suggested fare or caller-supplied amount,
  // binds checkout to one immutable booking. Closed rows remain reconciliation evidence.
  function checkoutContext(ride, status = ride.trip?.status) {
    const trip = ride.trip;
    check(trip && trip.rideId === ride.id && trip.customerId === ride.customerId && trip.driverId === ride.driverId
      && Number.isSafeInteger(trip.fareKobo) && trip.fareKobo > 0
      && Number.isSafeInteger(trip.bookedAt) && trip.bookedAt >= 0,
    'PAYMENT_NOT_READY', 'Confirm the agreed booking before paying its saved fare.');
    const paymentMode = trip.paymentMode ?? 'simulation';
    return { kind: 'ride', targetId: ride.id, customerId: trip.customerId, driverId: trip.driverId,
      amountKobo: trip.fareKobo, currency: 'NGN', bookedAt: trip.bookedAt, status,
      paymentMode, eligible: paymentMode === 'paystack_test' && ['booked', 'on_way', 'arrived', 'in_progress'].includes(status) };
  }

  async function negotiationFor(ride) {
    return restoreNegotiation(ride, ride.driverId ? (await repository.listFareEvents(ride.id)) : []);
  }

  async function peer(id, driver = false) {
    if (!id) return null;
    const user = (await getAccount(id));
    return { id: user.id, name: user.name, ...(driver ? { vehicle: user.driver.vehicle } : {}) };
  }

  async function view(ride, user) {
    const route = (await routeForRide(ride.id));
    const quote = route ?? createDemoQuote(ride.pickupId, ride.destinationId);
    const trip = ride.trip ?? (await repository.findTrip(ride.id));
    const delivery = await deliveries.view(ride, user, trip?.status ?? ride.status);
    return { id: ride.id, status: trip?.status ?? (ride.closedReason === 'request_expired' ? 'expired' : ride.status), version: ride.version,
      pickup: quote.pickup, destination: quote.destination, suggestedFareKobo: ride.suggestedFareKobo,
      currency: 'NGN', isDemo: true, route, vehicleCategory: ride.vehicleCategory, service: delivery ? 'delivery' : 'ride',
      delivery, createdAt: ride.createdAt, updatedAt: ride.updatedAt,
      passenger: passengerView((await passengerForRide(ride.id)), { isBooker: ride.customerId === user.id, bookerName: (await getAccount(ride.customerId)).name }),
      customer: (await peer(ride.customerId)), driver: ride.driverSnapshotJson ? JSON.parse(ride.driverSnapshotJson) : (await peer(ride.driverId, true)),
      negotiation: (await negotiationFor(ride))?.snapshot() ?? null,
      matching: ride.requestExpiresAt ? { expiresAt: ride.requestExpiresAt, expandedAt: ride.createdAt + EXPAND_MS,
        radiusMeters: route ? searchRadius(ride.createdAt, ride.matchedAt ?? (ride.closedReason ? ride.updatedAt : clock())) : null,
        mode: route ? 'gps' : 'sample', reason: ride.closedReason } : null,
      trip: trip ? { status: trip.status, fareKobo: trip.fareKobo, paymentMode: trip.paymentMode ?? 'simulation', bookedAt: trip.bookedAt,
        departedAt: trip.departedAt, arrivedAt: trip.arrivedAt, startedAt: trip.startedAt, completedAt: trip.completedAt,
        pinBlockedUntil: trip.pinBlockedUntil,
        ...(user.id === ride.customerId && trip.pickupPin ? { pickupPin: trip.pickupPin } : {}) } : null,
      activity: (await repository.activity(ride.id)), rating: (await repository.rating(ride.id)) };
  }

  async function get(user, id) {
    await expireTarget(user.id, id);
    const ride = (await record(id));
    requireParticipant(ride, user);
    return (await view(ride, user));
  }

  async function rate(user, id, data) {
    fields(data, ['stars'], ['stars']);
    check(Number.isInteger(data.stars) && data.stars >= 1 && data.stars <= 5, 'INVALID_RATING', 'Choose a rating from 1 to 5 stars.');
    return (await unitOfWork(async () => {
      const ride = (await record(id));
      check(ride.customerId === user.id && ride.driverId && ride.trip?.status === 'completed'
        && !(await deliveries.isDelivery(id)), 'RATING_UNAVAILABLE', 'Rate your driver after your completed ride.');
      const existing = (await repository.rating(id));
      check(existing === null || existing === data.stars, 'ALREADY_RATED', 'You have already rated this driver for this ride.');
      if (existing === null && (await repository.saveRating(ride, data.stars, clock()))) (await audit.record(user.id, 'ride.driver_rated', id, clock()));
      return { ride: (await view((await record(id)), user)) };
    }));
  }

  function requireMode(user, mode) {
    check(mode === null || ['customer', 'work'].includes(mode), 'INVALID_MODE', 'Choose Customer or Work.');
    if (mode) check(hasCapability(user, mode === 'work' ? 'driver' : 'customer'), 'FORBIDDEN', 'This account does not have that capability.');
  }
  const inMode = (ride, user, mode) => !mode || (mode === 'work' ? ride.driverId : ride.customerId) === user.id;

  async function list(user, mode = null) {
    requireMode(user, mode);
    await expireTarget(user.id);
    const now = clock();
    const position = mode !== 'customer' && hasCapability(user, 'driver') && user.driver?.status === 'approved' ? (await availabilityFor(user.id, now)) : null;
    const offer = position ? (await dispatch?.forDriver(user.id, now)) : null;
    const open = dispatch?.enabled ? (offer ? [(await repository.find(offer.rideId))].filter(Boolean) : []) : position ? (await repository.listAvailable({ now })) : [];
    const candidates = position ? (await asyncMap((await asyncFilter(open, async (ride) => ride.customerId !== user.id && !(await isParcelRecipient(user.id, ride.id)) && (await deliveries.matches(ride, user.driver.vehicle)))), async (ride) => ({ ride, metres: (await matchDistance(ride, position, now)) }))).filter((item) => item.metres !== null)
      .map(({ ride, metres }) => ({ ride, id: ride.id, createdAt: ride.createdAt, expiresAt: ride.requestExpiresAt,
        distanceMeters: position.mode === 'sample' ? null : metres })) : [];
    const available = rankEligibleMatches(candidates, now).slice(0, 50);
    return { matchingSettings: { allowSimulation, dispatchMode: dispatch?.mode ?? 'legacy' },
      activeElsewhere: (await asyncMap((await repository.activeFor(user.id)).filter((ride) => !inMode(ride, user, mode)), async (ride) => ({
        id: ride.id, mode: ride.customerId === user.id ? 'customer' : 'work', status: (await repository.findTrip(ride.id))?.status ?? ride.status }))),
      rides: (await asyncMap((await repository.listFor(user.id, mode)), async (ride) => (await view(ride, user)))), available: (await asyncMap(available, async ({ ride, distanceMeters, recommendation }) => {
      const route = (await routeForRide(ride.id));
      const area = (point) => ({ name: `Near ${point.lat.toFixed(2)}, ${point.lng.toFixed(2)} (approximate area)` });
      const quote = route ? { pickup: area(route.pickup), destination: area(route.destination) }
        : createDemoQuote(ride.pickupId, ride.destinationId);
      return { id: ride.id, version: ride.version, vehicleCategory: ride.vehicleCategory, service: (await deliveries.isDelivery(ride.id)) ? 'delivery' : 'ride', pickup: quote.pickup, destination: quote.destination,
        suggestedFareKobo: ride.suggestedFareKobo, currency: 'NGN', isDemo: true, hasRoute: Boolean(route), createdAt: ride.createdAt,
        expiresAt: ride.requestExpiresAt, approximateDistanceKm: route ? Math.ceil(distanceMeters / 1000) : null,
        ...(!dispatch?.enabled ? { recommendation } : {}),
        ...(dispatch?.enabled && offer ? { offer: { id: offer.id, expiresAt: offer.expiresAt, etaSource: offer.etaSource,
          pickupEtaMinutes: offer.etaSource === 'road' ? Math.max(1, Math.ceil(offer.pickupEtaSeconds / 60)) : null } } : {}) };
    })) };
  }

  async function matchDistance(ride, availability, now) {
    if (ride.status !== 'requested' || now >= ride.requestExpiresAt) return null;
    const route = (await routeForRide(ride.id));
    if (!route) return availability.mode === 'sample' && availability.areaId === ride.pickupId ? 0 : null;
    if (availability.mode !== 'gps') return null;
    const metres = distanceMeters(availability.position, route.pickup);
    return metres <= searchRadius(ride.createdAt, now) ? metres : null;
  }

  // Internal matching ports. Exact points never enter an available-request response.
  async function dispatchCandidate(ride, driverId, now) {
    const driver = (await getAccount(driverId));
    if (!ride || ride.customerId === driverId || !hasCapability(driver, 'driver') || driver.driver?.status !== 'approved'
      || !driver.driver.eligibility?.eligible || (await repository.hasNegotiation(driverId)) || (await hasOtherWork(driverId))
      || (await repository.hasCustomerWork(driverId, now)) || await isParcelRecipient(driverId, ride.id) || !(await deliveries.matches(ride, driver.driver.vehicle))) return null;
    const availability = (await availabilityFor(driverId, now));
    if (!availability) return null;
    const metres = (await matchDistance(ride, availability, now));
    if (metres === null) return null;
    const route = (await routeForRide(ride.id));
    return { rideId: ride.id, region: ride.dispatchRegion, driverId, availabilityId: availability.id, version: ride.version,
      createdAt: ride.createdAt, expiresAt: ride.requestExpiresAt,
      distanceMeters: route ? metres : null, pickupEtaSeconds: null,
      from: route ? availability.position : null, to: route?.pickup ?? null };
  }
  function projectedCandidate(context, driverId, driver, now) {
    if (!context || !driver) return null;
    const { ride, route } = context, { availability } = driver;
    if (ride.status !== 'requested' || now >= ride.requestExpiresAt || !matching.matches(context, driverId, driver.vehicle)) return null;
    const metres = route ? availability.mode === 'gps' ? distanceMeters(availability.position, route.pickup) : null
      : availability.mode === 'sample' && availability.areaId === ride.pickupId ? 0 : null;
    if (metres === null || route && metres > searchRadius(ride.createdAt, now)) return null;
    return { rideId: ride.id, region: ride.dispatchRegion, driverId, availabilityId: availability.id, version: ride.version,
      createdAt: ride.createdAt, expiresAt: ride.requestExpiresAt, distanceMeters: route ? metres : null,
      pickupEtaSeconds: null, from: route ? availability.position : null, to: route?.pickup ?? null };
  }
  async function dispatchCandidatesFor(edges, now) {
    // A separate read on every invocation; never reuses discovery's local cache.
    // The dispatch caller owns the transaction and regional feature gate.
    const contexts = await matching.rides(edges.map(edge => edge.rideId));
    const drivers = await matching.drivers(edges.map(edge => edge.driverId), now);
    const result = new Map();
    for (const { rideId, driverId } of edges) {
      const candidate = projectedCandidate(contexts.get(rideId), driverId, drivers.get(driverId), now);
      if (candidate) result.set(matchingPairKey(rideId, driverId), candidate);
    }
    return result;
  }
  const regionCursors = new Map(), driverCursors = new Map();
  const CANDIDATE_PAGE = 200, DRIVER_BUDGET = 1600;
  function rememberCursor(map, key, value) {
    if (map.size >= 5000 && !map.has(key)) map.delete(map.keys().next().value);
    if (value) map.set(key, value); else map.delete(key);
  }
  async function nearbyPage(ride, route, now, limit, afterId = '', fast = false) {
    const read = fast && nearbyMatchingDriverIds ? nearbyMatchingDriverIds : nearbyDriverIds;
    if (!read) return { driverIds: (await availableDriverIds()).slice(0, limit), nextCursor: null };
    return await read({ mode: route ? 'gps' : 'sample', areaId: ride.pickupId,
      position: route?.pickup, radiusMeters: searchRadius(ride.createdAt, now), now, limit, afterId });
  }
  async function dispatchCandidates(now, { region = null, excludeDriverIds = new Set(), excludeRideIds = new Set(),
    attempted = () => false, minimumAgeMs = 0 } = {}) {
    // Each regional cycle reads at most one ride page and a fixed driver budget.
    // Cursors rotate past incompatible/exhausted requests instead of rescanning
    // the same first page forever. Commit validation always reads fresh state.
    const cursorKey = region ?? '*', cursor = regionCursors.get(cursorKey);
    const rides = await repository.listAvailable({ region, after: cursor, limit: CANDIDATE_PAGE, now });
    const fast = matching?.enabledFor(region) === true;
    const contexts = fast ? await matching.rides(rides.map(ride => ride.id)) : null;
    const cache = new Map(), result = [];
    let eligibleRides = 0, driverReads = 0, lastRide = null, consumed = 0;
    for (const ride of rides) {
      if (driverReads >= DRIVER_BUDGET) break;
      lastRide = ride; consumed++;
      if (ride.status !== 'requested' || now >= ride.requestExpiresAt || excludeRideIds.has(ride.id)
        || now < ride.createdAt + minimumAgeMs) continue;
      if (fast && !contexts.has(ride.id)) continue;
      const route = fast ? contexts.get(ride.id).route : await routeForRide(ride.id), radius = searchRadius(ride.createdAt, now), edges = [];
      const driverCursor = driverCursors.get(ride.id);
      const pageLimit = Math.min(CANDIDATE_PAGE, DRIVER_BUDGET - driverReads);
      const page = await nearbyPage(ride, route, now, pageLimit, driverCursor?.expiresAt > now ? driverCursor.id : '', fast);
      // Charge the fetched page budget even when eligibility removes every row.
      driverReads += Math.max(1, page.scanned ?? (page.nextCursor ? pageLimit : page.driverIds.length));
      rememberCursor(driverCursors, ride.id, page.nextCursor ? { id: page.nextCursor, expiresAt: ride.requestExpiresAt } : null);
      if (fast) {
        const ids = page.driverIds.filter(id => !excludeDriverIds.has(id) && ride.customerId !== id && contexts.get(ride.id).recipientId !== id);
        const tried = await matching.attemptedMany(ids.map(driverId => ({ rideId: ride.id, driverId })));
        const untried = ids.filter(id => !tried.has(matchingPairKey(ride.id, id)));
        const missing = untried.filter(id => !cache.has(id));
        const loaded = await matching.drivers(missing, now);
        for (const id of missing) cache.set(id, loaded.get(id) ?? null);
        for (const id of untried) {
          const candidate = projectedCandidate(contexts.get(ride.id), id, cache.get(id), now);
          if (candidate) edges.push(candidate);
        }
      } else {
        for (const id of page.driverIds) {
          if (excludeDriverIds.has(id) || ride.customerId === id || await isParcelRecipient(id, ride.id) || await attempted(ride.id, id)) continue;
          if (!cache.has(id)) {
            const user = await getAccount(id);
            let candidate = null;
            if (hasCapability(user, 'driver') && user.driver?.status === 'approved' && user.driver.eligibility?.eligible
              && !await repository.hasNegotiation(id) && !await hasOtherWork(id) && !await repository.hasCustomerWork(id, now)) {
              const availability = await availabilityFor(id, now);
              if (availability) candidate = { vehicle: user.driver.vehicle, availability };
            }
            cache.set(id, candidate);
          }
          const driver = cache.get(id);
          if (!driver || !await deliveries.matches(ride, driver.vehicle)) continue;
          const { availability } = driver;
          const metres = route ? (availability.mode === 'gps' ? distanceMeters(availability.position, route.pickup) : null)
            : availability.mode === 'sample' && availability.areaId === ride.pickupId ? 0 : null;
          if (metres === null || route && metres > radius) continue;
          edges.push({ rideId: ride.id, region: ride.dispatchRegion, driverId: id, availabilityId: availability.id, version: ride.version,
            createdAt: ride.createdAt, expiresAt: ride.requestExpiresAt, distanceMeters: route ? metres : null,
            pickupEtaSeconds: null, from: route ? availability.position : null, to: route?.pickup ?? null });
        }
      }
      if (!edges.length) continue;
      edges.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0)
        || (a.driverId < b.driverId ? -1 : a.driverId > b.driverId ? 1 : 0));
      result.push(...edges.slice(0, DISPATCH_POLICY.maxDrivers));
      if (++eligibleRides >= DISPATCH_POLICY.maxRides) break;
    }
    rememberCursor(regionCursors, cursorKey, lastRide && (consumed < rides.length || rides.length === CANDIDATE_PAGE)
      ? { createdAt: lastRide.createdAt, id: lastRide.id } : null);
    return result;
  }

  async function history(user, beforeId = null, mode = null) {
    requireMode(user, mode);
    await expireTarget(user.id);
    let before = null;
    if (beforeId !== null) {
      check(typeof beforeId === 'string' && /^[a-f0-9-]{36}$/.test(beforeId), 'INVALID_CURSOR', 'Invalid history cursor.');
      before = (await record(beforeId));
      requireParticipant(before, user);
      check(inMode(before, user, mode), 'INVALID_CURSOR', 'This history cursor belongs to another mode.');
      check(before.status === 'cancelled' || before.trip?.status === 'completed', 'INVALID_CURSOR', 'Use a completed, cancelled or expired journey as the cursor.');
    }
    const rows = (await repository.history(user.id, before, 21, mode));
    const page = rows.slice(0, 20);
    return { rides: (await asyncMap(page, async (ride) => (await view(ride, user)))), nextBefore: rows.length > 20 ? page.at(-1).id : null };
  }

  async function create(user, data, now) {
    requireRole(user, 'customer');
    const routed = Boolean(data && Object.hasOwn(data, 'quoteId'));
    const required = routed ? ['quoteId'] : ['pickupId', 'destinationId'];
    fields(data, [...required, 'vehicleCategory', 'delivery', 'passenger'], required);
    const category = data.vehicleCategory === undefined ? 'standard' : data.vehicleCategory;
    check(transportCategory(category), 'INVALID_CATEGORY', 'Choose a vehicle category.');
    let passenger;
    try { passenger = passengerDetails(data.passenger, category); } catch (error) { check(false, 'INVALID_PASSENGER', error.message); }
    const delivery = (await deliveries.validate(category, data.delivery));
    check(!delivery || passenger.kind === 'self', 'INVALID_PASSENGER', 'Parcel deliveries cannot include a passenger booking.');
    if (!delivery) check(!ridePilot.paused, 'RIDES_PAUSED', 'New passenger ride requests are paused. Existing trips can continue.');
    let quote;
    if (routed) {
      check(typeof data.quoteId === 'string' && /^[a-f0-9-]{36}$/.test(data.quoteId), 'INVALID_ROUTE', 'Preview a route before requesting a ride.');
      quote = (await quoteForRide(user.id, data.quoteId, now));
      check((quote.vehicleCategory ?? 'standard') === category, 'QUOTE_CATEGORY_MISMATCH', 'Preview this category again before booking.');
    } else {
      check(allowSimulation, 'FORBIDDEN', 'Sample requests are available only in local development. Use a route preview for hosted testing.');
      try { quote = createDemoQuote(data.pickupId, data.destinationId); quote.suggestedFareKobo = categoryFare(quote.suggestedFareKobo, category); }
      catch (error) { check(false, 'INVALID_ROUTE', error.message); }
    }
    if (!delivery) check(ridePilot.allows(routed ? quote : null), 'RIDE_PILOT_AREA',
      'This passenger ride is outside the configured service area. Preview a route within the service area.');
    check(!(await repository.hasOpenRequest(user.id)), 'OPEN_REQUEST_EXISTS', 'You already have an open request. Finish or cancel it first.');
    check(!(await repository.hasDriverWork(user.id)) && !(await hasOtherWork(user.id)), 'DRIVER_BUSY', 'Finish or cancel your assigned work before requesting a personal ride.');
    check(!(await availabilityFor(user.id, now)), 'DRIVER_ONLINE', 'Go offline from Work before requesting a personal ride.');
    const id = tokens.id();
    (await repository.insert({ id, customerId: user.id, pickupId: quote.pickup.id,
      destinationId: quote.destination.id, suggestedFareKobo: quote.suggestedFareKobo, vehicleCategory: category, region: dispatchRegion(routed ? quote.pickup : null, quote.pickup.id), now, expiresAt: now + REQUEST_MS }));
    (await deliveries.create(id, delivery));
    (await savePassenger(id, passenger));
    if (routed) (await bindQuote(user.id, data.quoteId, id, now));
    (await audit.record(user.id, 'ride.requested', id, now));
    return id;
  }

  async function claim(user, id, data, now) {
    requireEligibleDriver(user);
    fields(data, ['expectedVersion', 'offerId'], ['expectedVersion']);
    const ride = (await record(id));
    check(ride.customerId !== user.id, 'FORBIDDEN', 'You cannot drive your own request.');
    check(!(await isParcelRecipient(user.id, id)), 'FORBIDDEN', 'You cannot deliver a parcel that you are receiving.');
    check((await deliveries.matches(ride, user.driver.vehicle)), 'VEHICLE_MISMATCH', 'This request needs a different approved vehicle category or load capacity.');
    check(ride.status === 'requested', 'REQUEST_UNAVAILABLE', 'Another driver took this request, or it is no longer open.');
    requireVersion(ride, data.expectedVersion);
    check(!(await repository.hasNegotiation(user.id)) && !(await hasOtherWork(user.id)), 'DRIVER_BUSY', 'Finish your current negotiation, trip or food delivery first.');
    check(!(await repository.hasCustomerWork(user.id, now)), 'CUSTOMER_BUSY', 'Finish or cancel your personal journey before accepting work.');
    const availability = (await availabilityFor(user.id, now));
    check(availability, 'DRIVER_OFFLINE', 'Go online with a fresh location before selecting a request.');
    check((await matchDistance(ride, availability, now)) !== null, 'OUTSIDE_MATCH_AREA', 'This request is outside your current matching area. Refresh nearby requests.');
    (await dispatch?.accept(user, id, data.offerId, now));
    check((await repository.claim({ id, driverId: user.id, driverSnapshot: (await peer(user.id, true)), expectedVersion: ride.version, now })),
      'STALE_VERSION', 'This request has changed. Refresh and try again.');
    (await audit.record(user.id, 'ride.claimed', id, now));
    (await onClaim(user.id, now));
    return id;
  }

  async function changeFare(user, id, action, data, now) {
    check(['propose', 'accept'].includes(action), 'NOT_FOUND', 'Action not found.');
    fields(data, action === 'propose' ? ['expectedVersion', 'amountKobo']
      : ['expectedVersion', 'offerId']);
    const ride = (await record(id));
    requireParticipant(ride, user);
    if (ride.driverId === user.id) requireRole(user, 'driver');
    requireVersion(ride, data.expectedVersion);
    check(['requested', 'negotiating'].includes(ride.status), 'REQUEST_CLOSED', 'This request has already ended.');
    check(ride.status === 'negotiating', 'NO_DRIVER', 'Wait for a driver before negotiating a fare.');
    const negotiation = (await negotiationFor(ride));
    const current = negotiation.snapshot();
    check(action !== 'propose' || current.offers.length < 100,
      'OFFER_LIMIT', 'This request has reached its offer limit. Accept the current offer or cancel.');
    const payload = { actorId: user.id, expectedVersion: current.version, now };
    if (action === 'propose') Object.assign(payload, { amountKobo: data.amountKobo, channel: 'in_app', validForMs: 120_000 });
    if (action === 'accept') payload.offerId = data.offerId;
    const next = negotiation[action](payload);
    const status = next.status === 'open' ? 'negotiating' : next.status;
    (await repository.appendFareEvent(id, next.version, action, payload));
    check((await repository.updateState({ id, status, expectedVersion: ride.version, now })),
      'STALE_VERSION', 'This request has changed. Refresh and try again.');
    (await audit.record(user.id, `fare.${action}`, id, now));
    return id;
  }

  async function changeTrip(user, id, action, data, now) {
    fields(data, action === 'start' ? ['expectedVersion', 'pickupPin']
      : action === 'cancel' ? ['expectedVersion', 'reason'] : action === 'complete' ? ['expectedVersion', 'deliveryPin'] : ['expectedVersion'],
    action === 'start' ? ['expectedVersion', 'pickupPin'] : ['expectedVersion']);
    const ride = (await record(id));
    requireParticipant(ride, user);
    if (ride.driverId === user.id) requireRole(user, 'driver');
    requireVersion(ride, data.expectedVersion);
    const status = ride.trip?.status ?? ride.status;
    let next;
    let reason = null;
    if (action === 'confirm') {
      requireRole(user, 'customer');
      check(ride.customerId === user.id, 'FORBIDDEN', 'Only the booking account can confirm this trip.');
      check(ride.status === 'agreed' && !ride.trip, 'INVALID_TRIP_STATE', 'An agreed fare is required before confirming this booking.');
      const driver = (await getAccount(ride.driverId));
      requireEligibleDriver(driver);
      check((await deliveries.matches(ride, driver.driver.vehicle)), 'VEHICLE_MISMATCH', 'The approved vehicle no longer matches this request.');
      check(!(await repository.hasOpenRequest(user.id)), 'OPEN_REQUEST_EXISTS', 'Finish or cancel your other request or trip before confirming.');
      check(!(await repository.hasNegotiation(ride.driverId)) && !(await hasOtherWork(ride.driverId)), 'DRIVER_BUSY', 'This driver has another negotiation, trip or food delivery. Ask them to finish it before confirming.');
      check(!(await repository.hasDriverWork(user.id)) && !(await hasOtherWork(user.id)), 'DRIVER_BUSY', 'Finish your assigned work before confirming a personal ride.');
      check(!(await repository.hasCustomerWork(ride.driverId, now)), 'CUSTOMER_BUSY', 'This driver has a personal journey to finish before taking work.');
      check(!(await availabilityFor(user.id, now)), 'DRIVER_ONLINE', 'Go offline from Work before confirming a personal ride.');
      const agreement = (await negotiationFor(ride)).snapshot().agreement;
      check(agreement, 'INVALID_TRIP_STATE', 'Both participants must agree the fare first.');
      (await repository.bookTrip({ ride, fareKobo: agreement.amountKobo,
        paymentMode: checkoutEnabled ? 'paystack_test' : 'simulation', pin: tokens.pickupPin(), now }));
      (await deliveries.confirm(id));
      next = 'booked';
    } else if (action === 'cancel') {
      check(canCancelRide(status), 'REQUEST_CLOSED', 'Only a request or a trip that has not started can be cancelled.');
      reason = data.reason ?? 'other';
      check(typeof reason === 'string' && Object.hasOwn(CANCELLATION_REASONS, reason), 'INVALID_REASON', 'Choose a cancellation reason.');
      if (ride.status === 'negotiating') {
        const negotiation = (await negotiationFor(ride));
        const payload = { actorId: user.id, expectedVersion: negotiation.snapshot().version, now };
        const cancelled = negotiation.cancel(payload);
        (await repository.appendFareEvent(id, cancelled.version, 'cancel', payload));
      }
      if (ride.trip) (await repository.updateTrip(id, 'cancelled', now));
      (await deliveries.cancel(id));
      next = 'cancelled';
    } else {
      requireRole(user, 'driver');
      check(ride.driverId === user.id, 'FORBIDDEN', 'Only the assigned driver can operate this trip.');
      const transition = TRIP_TRANSITIONS[action];
      check(transition && status === transition.from, 'INVALID_TRIP_STATE', 'This trip action is not available at the current stage.');
      // Fail before PIN attempts or lifecycle writes. Completion and cancellation
      // remain available when a working device loses GPS or connectivity.
      if (['depart', 'arrive', 'start'].includes(action)) await requireTripLocation(user.id, id);
      if (action === 'start') {
        requireEligibleDriver(user);
        check((await deliveries.matches(ride, user.driver.vehicle)), 'VEHICLE_MISMATCH', 'The approved vehicle no longer matches this request.');
        // This port reads verified local payment state inside this transaction.
        // A checkout redirect/provider callback alone cannot authorize a start.
        if (ride.trip.paymentMode === 'paystack_test') {
          check(typeof checkoutPayments?.requirePaid === 'function', 'PAYMENT_NOT_READY', 'Verified payment is required before this trip can start.');
          await checkoutPayments.requirePaid(checkoutContext(ride));
        }
        check(typeof data.pickupPin === 'string' && /^\d{6}$/.test(data.pickupPin), 'INVALID_PIN_FORMAT', 'Enter the customer’s six-digit pickup PIN.');
        const trip = ride.trip;
        check(!trip.pinBlockedUntil || trip.pinBlockedUntil <= now, 'PICKUP_PIN_LOCKED', 'Too many incorrect PINs. Wait five minutes from the last failed attempt before trying again.');
        if (!tokens.equal(data.pickupPin, trip.pickupPin)) {
          const failures = (trip.pinBlockedUntil && trip.pinBlockedUntil <= now ? 0 : trip.pinFailures) + 1;
          (await repository.failPin(id, failures, failures >= 5 ? now + 5 * 60_000 : null));
          // Do not throw inside the transaction: failure counters and retry keys must persist.
          (await audit.record(user.id, 'trip.pin_rejected', id, now));
          return { rideId: id, errorCode: 'INVALID_PICKUP_PIN' };
        }
      }
      if (action === 'complete') {
        const delivery = await deliveries.isDelivery(id);
        check(delivery || data.deliveryPin === undefined, 'INVALID_FIELDS', 'Passenger trips do not use a drop-off code.');
        if (delivery && !(await deliveries.verify(id, data.deliveryPin, now))) {
          (await audit.record(user.id, 'delivery.pin_rejected', id, now));
          return { rideId: id, errorCode: 'INVALID_DELIVERY_PIN' };
        }
      }
      next = transition.to;
      (await repository.updateTrip(id, next, now));
    }
    check((await repository.updateState({ id, status: next === 'cancelled' ? 'cancelled' : 'agreed', expectedVersion: ride.version, now })),
      'STALE_VERSION', 'This trip has changed. Refresh and try again.');
    (await repository.appendActivity(id, user.id, next, now, reason));
    (await audit.record(user.id, `trip.${next}`, id, now));
    // Closing checkout is atomic with cancellation. A pending provider success
    // must be reconciled as refund-required evidence, never reopen this booking.
    if (next === 'cancelled' && ride.trip?.paymentMode === 'paystack_test') {
      check(typeof checkoutPayments?.close === 'function', 'PAYMENT_NOT_READY', 'Payment cancellation is temporarily unavailable. Try again.');
      await checkoutPayments.close({ ...checkoutContext(ride, 'cancelled'), closedAt: now });
    }
    if (next === 'completed') (await onTripCompleted({ rideId: id, customerId: ride.customerId,
      driverId: ride.driverId, amountKobo: ride.trip.fareKobo, paymentMode: ride.trip.paymentMode ?? 'simulation', completedAt: now }));
    if (['completed', 'cancelled'].includes(next)) (await onRideClosed(id, now));
    return { rideId: id };
  }

  async function mutate({ userId, key, action, id = null, data }) {
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key),
      'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const fingerprint = tokens.digest(canonical({ action, id, data }));
    await expireTarget(userId, id);
    const result = (await unitOfWork(async () => {
      const user = (await getAccount(userId));
      check(user, 'UNAUTHENTICATED', 'Sign in to continue.');
      const previous = (await repository.findCommand(userId, key));
      if (previous) {
        check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This request key was already used for another action.');
        requireParticipant((await record(previous.rideId)), user);
        if ((await record(previous.rideId)).driverId === user.id) requireRole(user, 'driver');
        return previous.errorCode ? { errorCode: previous.errorCode }
          : { ride: (await view((await record(previous.rideId)), user)), replayed: true };
      }
      const now = clock();
      const tripAction = ['confirm', 'depart', 'arrive', 'start', 'complete', 'cancel'].includes(action);
      const outcome = tripAction ? (await changeTrip(user, id, action, data, now)) : { rideId:
        action === 'create' ? (await create(user, data, now)) : action === 'claim' ? (await claim(user, id, data, now))
          : (await changeFare(user, id, action, data, now)) };
      (await repository.saveCommand(userId, key, fingerprint, outcome.rideId, outcome.errorCode));
      if (!outcome.errorCode) {
        const ride = (await record(outcome.rideId));
        const recipients = action === 'create' && !dispatch?.enabled ? (await asyncFilter((await nearbyPage(ride, await routeForRide(ride.id), now, CANDIDATE_PAGE)).driverIds, async (driverId) => {
          const driver = (await getAccount(driverId)), position = (await availabilityFor(driverId, now));
          return driverId !== userId && driver?.driver && position && (await deliveries.matches(ride, driver.driver.vehicle)) && (await matchDistance(ride, position, now)) !== null;
        })) : [];
        (await onEvent({ kind: action === 'create' ? 'request' : action, ride, actorId: userId, recipients, eventKey: `ride:${ride.id}:${ride.version}`, now }));
      }
      return outcome.errorCode ? outcome : { ride: (await view((await record(outcome.rideId)), user)), replayed: false };
    }));
    check(!result.errorCode, result.errorCode, result.errorCode === 'INVALID_DELIVERY_PIN'
      ? 'The drop-off code is incorrect. Ask the recipient to check it. After five incorrect attempts, verification pauses for five minutes.'
      : 'The pickup PIN is incorrect. Ask the customer to check it. After five incorrect attempts, verification pauses for five minutes.');
    return result;
  }

  // Narrow read ports for communication: no fare replay or peer-profile loading.
  async function conversationContext(user, id) {
    const ride = (await record(id));
    requireParticipant(ride, user);
    return { id: ride.id, status: ride.trip?.status ?? ride.status, driverId: ride.driverId, customerId: ride.customerId };
  }

  async function conversationIds(user) {
    return (await repository.listFor(user.id)).filter((ride) => ride.driverId).map((ride) => ride.id);
  }

  async function paymentContext(user, id) {
    const ride = (await record(id));
    requireParticipant(ride, user);
    const route = (await routeForRide(id)) ?? createDemoQuote(ride.pickupId, ride.destinationId);
    return { rideId: id, customerId: ride.customerId, driverId: ride.driverId,
      status: ride.trip?.status ?? ride.status, amountKobo: ride.trip?.fareKobo ?? null,
      completedAt: ride.trip?.completedAt ?? null, pickup: route.pickup.name, destination: route.destination.name };
  }

  // Read-only checkout port. The checkout module restricts charging to customerId;
  // the assigned driver may read a sanitized payment status before starting work.
  async function checkoutPaymentContext(user, id) {
    const ride = await record(id);
    requireParticipant(ride, user);
    return checkoutContext(ride);
  }

  async function safetyContext(user, id) {
    const ride = (await record(id)); requireParticipant(ride, user);
    const route = (await routeForRide(id)) ?? createDemoQuote(ride.pickupId, ride.destinationId);
    return { rideId: id, customerId: ride.customerId, driverId: ride.driverId, status: ride.trip?.status ?? ride.status, pickup: route.pickup.name, destination: route.destination.name,
      driver: ride.driverSnapshotJson ? JSON.parse(ride.driverSnapshotJson) : (await peer(ride.driverId, true)) };
  }
  // Read-only port for the guest use case; the caller owns any surrounding transaction.
  async function guestContext(user, id) {
    const ride = (await record(id)); requireParticipant(ride, user);
    return { ...(await safetyContext(user, id)), passenger: (await passengerForRide(id)), bookerName: (await getAccount(ride.customerId)).name,
      pickupPin: ride.trip?.pickupPin ?? null };
  }
  // Minimal read port for family observers; never pass the passenger's pickup PIN.
  async function familyContext(user, id) {
    const ride = await record(id); requireParticipant(ride, user);
    const context = await safetyContext(user, id);
    return { rideId: id, customerId: ride.customerId, driverId: ride.driverId, status: context.status,
      pickup: context.pickup, destination: context.destination,
      driver: context.driver ? { name: context.driver.name, vehicle: context.driver.vehicle } : null,
      passenger: await passengerForRide(id), vehicleCategory: ride.vehicleCategory,
      service: (await deliveries.isDelivery(id)) ? 'delivery' : 'ride',
      completedAt: ride.trip?.completedAt ?? null };
  }
  return Object.freeze({ get, list, history, mutate, rate, conversationContext, conversationIds, paymentContext, checkoutPaymentContext, safetyContext, guestContext, familyContext, sweep,
    dispatchCandidates, dispatchCandidatesFor, dispatchCandidateFor: async (rideId, driverId, now) => (await dispatchCandidate((await repository.find(rideId)), driverId, now)) });
}
