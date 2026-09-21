import { deliveryDetails, vehicleMatches } from '../../../../../packages/shared/src/transport-categories.mjs';
import { check } from '../../shared/errors.mjs';

export function createDeliveriesService({ repository, tokens }) {
  function validate(category, data) {
    try { return deliveryDetails(category, data); }
    catch (error) { check(false, 'INVALID_DELIVERY', error.message); }
  }
  function matches(ride, vehicle) {
    return vehicleMatches(vehicle, ride.vehicleCategory, repository.find(ride.id)?.details.weightKg);
  }
  function view(ride, user, status) {
    const order = repository.find(ride.id);
    if (!order) return null;
    return { ...order.details, verifiedAt: order.verifiedAt, pinBlockedUntil: order.pinBlockedUntil,
      ...(user.id === ride.customerId && status === 'in_progress' && order.dropoffPin ? { dropoffPin: order.dropoffPin } : {}) };
  }
  function verify(id, pin, now) {
    const order = repository.find(id);
    check(order?.dropoffPin, 'INVALID_TRIP_STATE', 'This delivery is not ready for handover.');
    check(typeof pin === 'string' && /^\d{6}$/.test(pin), 'INVALID_PIN_FORMAT', 'Enter the recipient’s six-digit drop-off code.');
    check(!order.pinBlockedUntil || order.pinBlockedUntil <= now, 'DELIVERY_PIN_LOCKED', 'Too many incorrect codes. Wait five minutes before trying again.');
    if (!tokens.equal(pin, order.dropoffPin)) {
      const failures = (order.pinBlockedUntil && order.pinBlockedUntil <= now ? 0 : order.pinFailures) + 1;
      repository.fail(id, failures, failures >= 5 ? now + 300_000 : null);
      return false;
    }
    repository.close(id, now);
    return true;
  }
  return Object.freeze({ validate, matches, view, verify,
    create: (id, details) => { if (details) repository.insert(id, details); },
    confirm: (id) => { if (repository.find(id)) repository.issue(id, tokens.pickupPin()); },
    cancel: (id) => repository.close(id, null) });
}
