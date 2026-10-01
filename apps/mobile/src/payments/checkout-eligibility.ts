import type { BookingRide } from '../../../../packages/shared/src/mobile-booking.mjs';

export function showJourneyCheckout(ride: Pick<BookingRide, 'status' | 'paymentMode'>): boolean {
  // Only a confirmed trip receives paymentMode; an agreed fare alone is not a booking.
  return ['booked', 'on_way', 'arrived', 'in_progress', 'completed'].includes(ride.status)
    || ride.status === 'cancelled' && ride.paymentMode !== undefined;
}
