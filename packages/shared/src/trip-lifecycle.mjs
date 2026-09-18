/** Transport-independent lifecycle vocabulary used by the API and web client. */
export const TRIP_TRANSITIONS = Object.freeze({
  depart: Object.freeze({ from: 'booked', to: 'on_way', label: 'On my way' }),
  arrive: Object.freeze({ from: 'on_way', to: 'arrived', label: 'I have arrived' }),
  start: Object.freeze({ from: 'arrived', to: 'in_progress', label: 'Verify PIN and start trip' }),
  complete: Object.freeze({ from: 'in_progress', to: 'completed', label: 'Complete trip' }),
});

export const RIDE_STATUS_LABELS = Object.freeze({
  requested: 'Waiting for a driver', negotiating: 'Negotiating', agreed: 'Fare agreed · confirm booking',
  booked: 'Booking confirmed', on_way: 'Driver on the way', arrived: 'Driver arrived',
  in_progress: 'Trip in progress', completed: 'Completed', cancelled: 'Cancelled',
});

export const CANCELLATION_REASONS = Object.freeze({
  plans_changed: 'Plans changed', pickup_problem: 'Pickup problem', other: 'Other reason',
});

export function isActiveRide(status) {
  return ['requested', 'negotiating', 'booked', 'on_way', 'arrived', 'in_progress'].includes(status);
}

export function canCancelRide(status) {
  return ['requested', 'negotiating', 'agreed', 'booked', 'on_way', 'arrived'].includes(status);
}

export function canChatDuringRide(status) {
  return ['negotiating', 'agreed', 'booked', 'on_way', 'arrived', 'in_progress'].includes(status);
}
