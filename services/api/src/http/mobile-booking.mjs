import { DEMO_AREAS, createDemoQuote } from '../../../../packages/shared/src/demo-booking.mjs';
import { transportCategory, categoryFare } from '../../../../packages/shared/src/transport-categories.mjs';
import { canCancelRide } from '../../../../packages/shared/src/trip-lifecycle.mjs';
import { check } from '../shared/errors.mjs';
import { fields } from '../shared/validation.mjs';

const terminal = new Set(['completed', 'cancelled', 'expired']);
const geometry = (route) => route ? { distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds,
  coordinates: route.coordinates, distanceKind: route.distanceKind ?? 'road',
  pricing: route.pricing ? { baseKobo: route.pricing.baseKobo, distanceKobo: route.pricing.distanceKobo, timeKobo: route.pricing.timeKobo,
    minimumKobo: route.pricing.minimumKobo, incrementKobo: route.pricing.incrementKobo } : undefined } : null;
export function bookingProjection(ride) {
  return { id: ride.id, version: ride.version, status: ride.status, vehicleCategory: ride.vehicleCategory, service: ride.service, delivery: ride.delivery, passenger: ride.passenger, pickup: ride.pickup.name, destination: ride.destination.name,
    suggestedFareKobo: ride.suggestedFareKobo, fareKobo: ride.trip?.fareKobo ?? ride.negotiation?.agreement?.amountKobo ?? null,
    expiresAt: ride.status === 'requested' ? ride.matching.expiresAt : null, canCancel: canCancelRide(ride.status),
    driver: ride.driver ? { name: ride.driver.name, vehicle: ride.driver.vehicle } : null };
}

/** Native transport/projections only. The existing location and ride services own every mutation. */
export function createMobileBooking({ rides, locations, availability, clock }) {
  const own = async (user, id) => {
    const ride = (await rides.get(user, id));
    check(ride.customer.id === user.id, 'NOT_FOUND', 'Customer request not found.'); return ride;
  };
  return async ({ path, write, user, accessToken, data, key }) => {
    const context = { userId: user.id, sessionToken: accessToken, native: true };
    if (!write && path === '/booking') {
      const list = (await rides.list(user, 'customer')), maps = (await locations.settings(context));
      return { online: { enabled: maps.enabled, searchHost: maps.searchHost ?? null, routeHost: maps.routeHost ?? null },
        allowSample: list.matchingSettings.allowSimulation, areas: list.matchingSettings.allowSimulation ? DEMO_AREAS : [],
        current: list.rides.filter((r) => !terminal.has(r.status)).map(bookingProjection),
        blockedBy: list.activeElsewhere.length ? 'work' : (await availability.positionFor(user.id, clock())) ? 'online' : null };
    }
    if (write && path === '/booking/search') return (await locations.search(context, data));
    if (write && path === '/booking/quotes') {
      const { quote, replayed } = await locations.quote(context, data, key);
      return { preview: { kind: 'route', pickup: quote.route.pickup.name, destination: quote.route.destination.name,
        suggestedFareKobo: quote.route.suggestedFareKobo, expiresAt: quote.expiresAt,
        vehicleCategory: quote.route.vehicleCategory ?? 'standard', request: { quoteId: quote.id, vehicleCategory: quote.route.vehicleCategory ?? 'standard' }, route: geometry(quote.route) }, replayed };
    }
    if (write && path === '/booking/sample') {
      fields(data, ['pickupId', 'destinationId', 'vehicleCategory'], ['pickupId', 'destinationId']);
      const category = data.vehicleCategory === undefined ? 'standard' : data.vehicleCategory;
      check(transportCategory(category), 'INVALID_CATEGORY', 'Choose a vehicle category.');
      check((await rides.list(user, 'customer')).matchingSettings.allowSimulation, 'FORBIDDEN', 'Sample journeys are disabled here.');
      check(DEMO_AREAS.some((a) => a.id === data.pickupId) && DEMO_AREAS.some((a) => a.id === data.destinationId)
        && data.pickupId !== data.destinationId, 'INVALID_LOCATION', 'Choose two different sample areas.');
      const quote = createDemoQuote(data.pickupId, data.destinationId);
      return { preview: { kind: 'sample', pickup: quote.pickup.name, destination: quote.destination.name,
        suggestedFareKobo: categoryFare(quote.suggestedFareKobo, category), vehicleCategory: category, expiresAt: null, request: { ...data, vehicleCategory: category }, route: null } };
    }
    if (write && path === '/booking/requests') {
      const result = (await rides.mutate({ userId: user.id, action: 'create', data, key }));
      return { ride: bookingProjection(result.ride), replayed: result.replayed };
    }
    const match = path.match(/^\/booking\/requests\/([a-f0-9-]{36})(\/cancel)?$/);
    if (match && !write && !match[2]) return { ride: bookingProjection((await own(user, match[1]))) };
    if (match && write && match[2]) {
      (await own(user, match[1]));
      const result = (await rides.mutate({ userId: user.id, action: 'cancel', id: match[1], data, key }));
      return { ride: bookingProjection(result.ride), replayed: result.replayed };
    }
    check(false, 'NOT_FOUND', 'Mobile booking endpoint not found.');
  };
}
