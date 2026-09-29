import type { BookingRide } from '../../../../packages/shared/src/mobile-booking.mjs';
import { Text } from '../ui/typography';
import { styles } from '../ui/components';

export function PassengerSummary({ passenger, bookedBy, showPhone = false }: { passenger: BookingRide['passenger']; bookedBy?: string; showPhone?: boolean }) {
  if (passenger?.kind !== 'guest') return null;
  return <><Text style={styles.body}>Passenger · {passenger.name}</Text>{bookedBy && <Text style={styles.small}>Booked by · {bookedBy}</Text>}{showPhone && passenger.phone && <Text style={styles.small}>Passenger contact · {passenger.phone}</Text>}</>;
}
