import { Text } from 'react-native';
import type { BookingRide } from '../../../../packages/shared/src/mobile-booking.mjs';
import { bookingStatusLabel, isRequestOpen } from '../../../../packages/shared/src/mobile-booking.mjs';
import { Button, Card, fare, Pill, styles } from '../ui/components';
import { VehicleCard } from '../ui/vehicle-card';

export function RequestCard({ ride, now, disabled, onCancel, onWebsite }: {
  ride: BookingRide; now: number; disabled: boolean; onCancel(): void; onWebsite(): void;
}) {
  const waiting = ride.status === 'requested', open = isRequestOpen(ride.status);
  return <Card><Pill>{bookingStatusLabel(ride.status).toUpperCase()}</Pill>
    <Text style={styles.h2}>{ride.pickup} → {ride.destination}</Text>
    <Text style={styles.body}>{ride.fareKobo === null ? 'Suggested fare' : 'Agreed fare'} · {fare(ride.fareKobo ?? ride.suggestedFareKobo)}</Text>
    {waiting && <Text style={styles.body}>Your preview request is available to eligible drivers. A fare still needs to be agreed before booking.</Text>}
    {waiting && ride.expiresAt !== null && <Text style={styles.small}>{now >= ride.expiresAt ? 'The request window has ended. Refresh for the latest status.'
      : `Request window: about ${Math.max(1, Math.ceil((ride.expiresAt - now) / 60_000))} min remaining.`}</Text>}
    {ride.status === 'expired' && <Text style={styles.body}>No driver took this request before it expired. You can review a new route and try again.</Text>}
    {ride.status === 'cancelled' && <Text style={styles.body}>This request is cancelled.</Text>}
    {ride.driver && <><Text style={styles.body}>Driver · {ride.driver.name}</Text><VehicleCard vehicle={ride.driver.vehicle} label="VEHICLE FOR THIS JOURNEY" compact/></>}
    {open && !waiting && <><Text style={styles.body}>Continue fare negotiation, chat and trip controls on the website. Native controls are coming in the next stages.</Text><Button title="Continue on website" onPress={onWebsite}/><Text style={styles.small}>Opens your browser. Sign in with the same account to continue.</Text></>}
    {ride.canCancel && <Button title={waiting ? 'Cancel request' : 'Cancel journey'} secondary disabled={disabled} onPress={onCancel}/>}
    <Text style={styles.small}>Development preview · no live transport.</Text>
  </Card>;
}
