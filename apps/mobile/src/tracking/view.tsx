import { useSyncExternalStore } from 'react';
import { Alert } from 'react-native';
import { Text } from '../ui/typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Button, Card, Notice, Pill, styles } from '../ui/components';
import { useTripLocation, useTripLocationControllers } from './provider';
import type { TripLocationController } from './controller';
import { NativeMap } from '../maps/native-map';
import { kemmyUpdate } from '../../../../packages/shared/src/kemmy.mjs';
import type { Journey } from '../../../../packages/shared/src/mobile-journeys.mjs';

export function TripLocationCard({ id, ride }: { id: string; ride?: Journey }) {
  const { controller: c, state: s } = useTripLocation(id), data = s.data, share = data?.share;
  const position = share?.active ? share.position : null;
  const age = position ? Math.max(0, Math.floor((s.now - position.capturedAt) / 1000)) : 0;
  const stale = s.stale || share?.stale || age >= 30;
  const update = ride ? kemmyUpdate(ride, { position, now: s.now, stale }) : null;
  const travelEta = update && ['arrived', 'in_progress'].includes(ride?.status ?? '') ? update.tripMinutes : null;
  const route = ride?.route;
  const routePoints = route?.coordinates.map(([lng, lat]) => ({ lng, lat })) ?? [];
  return <Card><Text style={styles.h2}>Driver’s trip location</Text>
    <Notice message={s.error}/>
    {update?.pickupMinutes && <Text style={styles.body}>Estimated pickup: about {update.pickupMinutes} min · based on recent driver GPS</Text>}
    {travelEta && <Text style={styles.body}>Estimated time to destination: about {travelEta} min · planned map route</Text>}
    {position ? <><Pill>{stale ? 'LAST KNOWN LOCATION' : 'RECENT DRIVER LOCATION'}</Pill>
      <Text style={styles.body}>Recorded {new Date(position.capturedAt).toLocaleTimeString()} · {age} seconds ago</Text>
      <Text style={styles.small}>Reported accuracy: {Math.round(position.accuracy)} m · {position.lat.toFixed(5)}, {position.lng.toFixed(5)}</Text>
    </> : <Text style={styles.body}>No driver-shared location is available.</Text>}
    {(position || route) && <NativeMap route={routePoints} pins={[
      ...(route ? [{ id: 'pickup', lat: route.pickup.lat, lng: route.pickup.lng, title: 'Pickup' },
        { id: 'destination', lat: route.destination.lat, lng: route.destination.lng, title: 'Destination' }] : []),
      ...(position ? [{ id: 'driver', lat: position.lat, lng: position.lng, title: stale ? 'Last known driver location' : 'Reported driver location', stale: Boolean(stale),
        description: `Recorded ${new Date(position.capturedAt).toLocaleTimeString()} · accuracy ${Math.round(position.accuracy)} m` }] : []),
    ]} summary={`Journey map${travelEta ? `, approximately ${travelEta} minutes to destination` : ''}.`}/>}
    <Text style={styles.small}>Location is reported by the driver’s phone and may have changed. Updates stop when Taxi Ai leaves the foreground. The last location may remain visible for up to one minute if Stop cannot reach the server. {ride?.delivery ? 'The sender and the recipient who accepted the private parcel invitation can follow this delivery after collection.' : 'Trip-link recipients can also see it.'}</Text>
    {s.sharing && <Pill>THIS PHONE IS SHARING</Pill>}
    {data?.isDriver && share?.active && !share.owned && <Text style={styles.body}>Another device or browser is sharing for this trip. You can stop it here before sharing from this phone.</Text>}
    {data?.canShare && !share?.active && !s.sharing && <Button title="Share my location" busy={s.busy} disabled={s.stale || s.loading || s.uncertain} onPress={() => Alert.alert('Share your trip location?', `${ride?.delivery ? 'Your sender and the recipient who accepted the parcel invitation can see your reported location after collection. Active private trip-link viewers can also see it.' : 'Your customer and anyone with an active private trip link can see your reported location.'} Keep Taxi Ai open for updates. You can stop at any time; if disconnected, the last location may remain visible for up to one minute.`, [
      { text: 'Back', style: 'cancel' }, { text: 'Share location', onPress: () => void c.start() },
    ])}/>}
    {data?.isDriver && (share?.active || s.sharing || s.busy) && <Button title="Stop sharing location" secondary onPress={() => void c.stop()}/>}
    {s.uncertain && <Button title="Resolve interrupted location action" secondary busy={s.busy} onPress={() => void c.retry()}/>}
    <Button title="Refresh location" secondary busy={s.loading} disabled={s.busy} onPress={() => void c.refresh()}/>
  </Card>;
}
function LocationStatus({ controller: c }: { controller: TripLocationController }) {
  const s = useSyncExternalStore(c.subscribe, c.snapshot);
  if (!s.sharing && !s.uncertain) return null;
  return <SafeAreaView edges={['top', 'left', 'right']} style={{ paddingHorizontal: 16 }}><Text style={styles.small} accessibilityLiveRegion="polite">{s.sharing ? 'Your trip location is being shared.' : 'Location updates stopped on this phone. Server confirmation is pending.'}</Text>
    <Button title="Review trip location" secondary onPress={() => router.push({ pathname: '/safety', params: { id: c.id } })}/>
  </SafeAreaView>;
}
export function TripLocationStatus() { const controllers = useTripLocationControllers(); return <>{controllers.map(c => <LocationStatus key={c.clientId} controller={c}/>)}</>; }
