import { deliveryDetails, vehicleMatches } from '../../../../../packages/shared/src/transport-categories.mjs';
import { check } from '../../shared/errors.mjs';

export function createDeliveriesService({ repository, tokens, handoverContext = null, requireHandover = async () => {} }) {
  function validate(category, data) {
    try { return deliveryDetails(category, data); }
    catch (error) { check(false, 'INVALID_DELIVERY', error.message); }
  }
  async function matches(ride, vehicle) {
    return vehicleMatches(vehicle, ride.vehicleCategory, (await repository.find(ride.id))?.details.weightKg);
  }
  async function view(ride, user, status) {
    const order = (await repository.find(ride.id));
    if (!order) return null;
    return { ...order.details, verifiedAt: order.verifiedAt, arrivedAt: order.arrivedAt, pinBlockedUntil: order.pinBlockedUntil,
      ...(user.id === ride.customerId && status === 'in_progress' && order.dropoffPin ? { dropoffPin: order.dropoffPin } : {}) };
  }
  async function verify(id, pin, now) {
    await requireHandover(id);
    const order = (await repository.find(id));
    check(order?.dropoffPin, 'INVALID_TRIP_STATE', 'This delivery is not ready for handover.');
    check(typeof pin === 'string' && /^\d{6}$/.test(pin), 'INVALID_PIN_FORMAT', 'Enter the recipient’s six-digit drop-off code.');
    check(!order.pinBlockedUntil || order.pinBlockedUntil <= now, 'DELIVERY_PIN_LOCKED', 'Too many incorrect codes. Wait five minutes before trying again.');
    if (!tokens.equal(pin, order.dropoffPin)) {
      const failures = (order.pinBlockedUntil && order.pinBlockedUntil <= now ? 0 : order.pinFailures) + 1;
      (await repository.fail(id, failures, failures >= 5 ? now + 300_000 : null));
      return false;
    }
    if (handoverContext) {
      const evidence = await handoverContext(id, now);
      check(evidence?.courierId, 'INVALID_TRIP_STATE', 'Assigned courier evidence is unavailable.');
      const p = evidence.position;
      // A handover never invents coordinates when GPS is missing or old.
      const position = p && !p.stale && Number.isFinite(p.lat) && Number.isFinite(p.lng)
        && Number.isFinite(p.accuracy) && Number.isSafeInteger(p.capturedAt)
        && p.capturedAt > now - 30_000 && p.capturedAt <= now + 5000
        ? { lat: p.lat, lng: p.lng, accuracy: p.accuracy, capturedAt: p.capturedAt } : null;
      await repository.evidence(id, evidence.courierId, now, position);
    }
    (await repository.close(id, now));
    return true;
  }
  async function arrive(id, now) {
    check(await repository.arrive(id, now), 'INVALID_TRIP_STATE', 'Arrival at the recipient has already been recorded or this delivery is unavailable.');
  }
  return Object.freeze({ validate, matches, view, verify, arrive,
    isDelivery: async (id) => Boolean(await repository.find(id)),
    create: async (id, details) => { if (details) (await repository.insert(id, details)); },
    confirm: async (id) => { if ((await repository.find(id))) (await repository.issue(id, tokens.pickupPin())); },
    cancel: async (id) => (await repository.close(id, null)) });
}
