import { Text } from './typography';
import { router } from 'expo-router';
import type { Journey } from '../../../../packages/shared/src/mobile-journeys.mjs';
import { arrivalNotice } from '../../../../packages/shared/src/pickup-identity.mjs';
import { Button, Card, styles } from './components';
import { VehiclePhotoCheck } from '../vehicle-checks/card';

export function PickupIdentity({ ride }: { ride: Journey }) {
  if (ride.mode !== 'customer' || !ride.driver || !['booked','on_way','arrived'].includes(ride.status)) return null;
  const notice = arrivalNotice(ride.driver);
  if (ride.passenger?.kind === 'guest') return <Card><Text accessibilityLiveRegion="polite" style={styles.h2}>{ride.status === 'arrived' ? 'Driver reports arriving for your passenger' : 'Help your passenger check the pickup'}</Text>
    <Text style={styles.body}>Ask your passenger to check the driver’s name and the vehicle’s number plate, make, model and colour before boarding. They should give the PIN only to the correct driver at pickup.</Text>
    <Text style={styles.small}>Share the private passenger link for these details. Driver arrival is self-reported; it does not confirm that your passenger has met the driver.</Text>
    <Button title="Passenger reports a vehicle mismatch?" secondary onPress={() => router.push({ pathname: '/safety', params: { id: ride.id, concern: 'vehicle_mismatch' } })}/>
  </Card>;
  return <Card><Text accessibilityLiveRegion="polite" style={styles.h2}>{ride.status === 'arrived' ? notice?.title : 'Check your pickup vehicle'}</Text>
    {ride.status === 'arrived' && <Text style={styles.body}>{notice?.body}</Text>}
    <Text style={styles.body}>Compare the number plate, make/model and colour with the vehicle in front of you. If anything differs, do not board, hand over a parcel or share your pickup PIN.</Text>
    <Text style={styles.small}>Arrival is reported by the driver. The example image does not verify the physical vehicle.</Text>
    <Button title="Vehicle doesn’t match?" secondary onPress={() => router.push({ pathname: '/safety', params: { id: ride.id, concern: 'vehicle_mismatch' } })}/>
    <VehiclePhotoCheck rideId={ride.id}/>
  </Card>;
}
