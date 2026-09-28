import { TRIP_TRANSITIONS, canCancelRide } from '/shared/trip-lifecycle.mjs';

/** Controls are derived from the displayed snapshot; the API authorizes every action. */
export function tripControls(ride, user, now) {
  const participant = ride && user && [ride.customer.id, ride.driver?.id].includes(user.id);
  const driver = participant && user.role === 'driver' && user.driver?.status === 'approved' && ride.driver?.id === user.id;
  const next = driver ? Object.entries(TRIP_TRANSITIONS).find(([, step]) => step.from === ride.status) : null;
  return {
    confirm: Boolean(participant && user.role === 'customer' && user.id === ride.customer.id && ride.status === 'agreed' && ride.negotiation?.agreement),
    cancel: Boolean(participant && (user.role === 'customer' || driver) && canCancelRide(ride.status)),
    next: next ? { action: next[0], ...next[1] } : null,
    pin: participant && user.id === ride.customer.id && ['booked', 'on_way', 'arrived'].includes(ride.status)
      ? ride.trip?.pickupPin ?? null : null,
    pinLocked: Boolean(ride?.trip?.pinBlockedUntil > now),
  };
}
