import { router } from 'expo-router';
import { vehicleCategory } from '../../../../packages/shared/src/vehicle-categories.mjs';
import { Text } from '../ui/typography';
import type { BookingRide } from '../../../../packages/shared/src/mobile-booking.mjs';
import { bookingStatusLabel, isRequestOpen } from '../../../../packages/shared/src/mobile-booking.mjs';
import { Button, Card, fare, Pill, styles } from '../ui/components';
import { VehicleCard } from '../ui/vehicle-card';
import { PassengerSummary } from '../guest-rides/passenger-summary';

export function RequestCard({ ride, now, disabled, onCancel }: {
  ride: BookingRide; now: number; disabled: boolean; onCancel(): void;
}) {
  const waiting = ride.status === 'requested', open = isRequestOpen(ride.status);
  return <Card><Pill>{bookingStatusLabel(ride.status).toUpperCase()}</Pill>
    <Text style={styles.small}>{vehicleCategory(ride.vehicleCategory ?? 'standard')?.name}{ride.delivery ? ' delivery' : ' ride'}</Text>
    {ride.delivery && <><Text style={styles.body}>{ride.delivery.description} · {ride.delivery.weightKg} kg · Recipient: {ride.delivery.recipientName}</Text>{ride.delivery.dropoffPin && <><Text style={styles.label}>RECIPIENT’S DROP-OFF CODE</Text><Text selectable style={styles.title}>{ride.delivery.dropoffPin}</Text><Text style={styles.small}>Share privately with your recipient. They give it to the driver only at handover.</Text></>}</>}
    <Text style={styles.h2}>{ride.pickup} → {ride.destination}</Text>
    <PassengerSummary passenger={ride.passenger} bookedBy="You" showPhone/>
    <Text style={styles.body}>{ride.fareKobo === null ? 'Suggested fare' : 'Agreed fare'} · {fare(ride.fareKobo ?? ride.suggestedFareKobo)}</Text>
    {waiting && <Text style={styles.body}>Your preview request is available to eligible drivers. A fare still needs to be agreed before booking.</Text>}
    {waiting && ride.expiresAt !== null && <Text style={styles.small}>{now >= ride.expiresAt ? 'The request window has ended. Refresh for the latest status.'
      : `Request window: about ${Math.max(1, Math.ceil((ride.expiresAt - now) / 60_000))} min remaining.`}</Text>}
    {ride.status === 'expired' && <Text style={styles.body}>No driver took this request before it expired. You can review a new route and try again.</Text>}
    {ride.status === 'cancelled' && <Text style={styles.body}>This request is cancelled.</Text>}
    {ride.driver && <><Text style={styles.body}>Driver · {ride.driver.name}</Text><VehicleCard vehicle={ride.driver.vehicle} label="VEHICLE FOR THIS JOURNEY" compact/></>}
    <Button title={open ? 'Open journey and chat' : 'View journey'} disabled={disabled} onPress={() => router.push({ pathname: '/journey', params: { id: ride.id } })}/>
    {ride.canCancel && <Button title={waiting ? 'Cancel request' : 'Cancel journey'} secondary disabled={disabled} onPress={onCancel}/>}
    <Text style={styles.small}>Development preview · no live transport.</Text>
  </Card>;
}
