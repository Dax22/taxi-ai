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
import type { TrackingKind } from './background-contracts';
import { canShareLocation } from '../../../../packages/shared/src/locations.mjs';

export function TripLocationCard({ id, ride, kind = 'ride', destination }: { id: string; ride?: Journey; kind?: TrackingKind; destination?: { lat: number; lng: number } | null }) {
  const { controller: c, state: s } = useTripLocation(id, kind), data = s.data, share = data?.share;
  const position = share?.active && (!ride || canShareLocation(ride.status)) ? share.position : null;
  const age = position ? Math.max(0, Math.floor((s.now - position.capturedAt) / 1000)) : 0;
  const stale = s.stale || share?.stale || age >= 30;
  const update = ride ? kemmyUpdate(ride, { position, now: s.now, stale }) : null;
  const travelEta = update && ['arrived', 'in_progress'].includes(ride?.status ?? '') ? update.tripMinutes : null;
  const route = ride?.route;
  const operator = kind === 'food' ? 'courier' : 'driver';
  const routePoints = route?.coordinates.map(([lng, lat]) => ({ lng, lat })) ?? [];
  const audience = kind === 'food' ? 'The food buyer can see your reported delivery location.'
    : ride?.delivery ? 'Your sender and the recipient who accepted the parcel invitation can see your reported location after collection. Active private trip-link viewers can also see it.'
      : 'Your customer and anyone with an active private trip link can see your reported location.';
  return <Card><Text style={styles.h2}>{kind === 'food' ? 'Courier’s delivery location' : 'Driver’s trip location'}</Text>
    <Notice message={s.error}/>
    {kind === 'food' && data && !data.isDriver && <Text style={styles.small}>Courier location appears after collection. It may be temporarily hidden to protect a private pickup location.</Text>}
    {data?.isDriver && data.required && <Text style={styles.body}>Live location is required during active work. Start sharing before progressing this job. You can always stop sharing, complete the handover, cancel or access safety help.</Text>}
    {update?.pickupMinutes && <Text style={styles.body}>Estimated pickup: about {update.pickupMinutes} min · based on recent driver GPS</Text>}
    {travelEta && <Text style={styles.body}>Estimated time to destination: about {travelEta} min · planned map route</Text>}
    {position ? <><Pill>{stale ? 'LAST KNOWN LOCATION' : `RECENT ${operator.toUpperCase()} LOCATION`}</Pill>
      <Text style={styles.body}>Recorded {new Date(position.capturedAt).toLocaleTimeString()} · {age} seconds ago</Text>
      <Text style={styles.small}>Reported accuracy: {Math.round(position.accuracy)} m · {position.lat.toFixed(5)}, {position.lng.toFixed(5)}</Text>
    </> : <Text style={styles.body}>No {operator}-shared location is available.</Text>}
    {(position || route || destination) && <NativeMap route={routePoints} pins={[
      ...(route ? [{ id: 'pickup', lat: route.pickup.lat, lng: route.pickup.lng, title: 'Pickup' },
        { id: 'destination', lat: route.destination.lat, lng: route.destination.lng, title: 'Destination' }] : []),
      ...(!route && destination ? [{ id: 'destination', lat: destination.lat, lng: destination.lng, title: 'Delivery destination' }] : []),
      ...(position ? [{ id: 'driver', lat: position.lat, lng: position.lng, title: stale ? `Last known ${operator} location` : `Reported ${operator} location`, stale: Boolean(stale),
        description: `Recorded ${new Date(position.capturedAt).toLocaleTimeString()} · accuracy ${Math.round(position.accuracy)} m` }] : []),
    ]} summary={`${kind === 'food' ? 'Delivery' : 'Journey'} map${travelEta ? `, approximately ${travelEta} minutes to destination` : ''}.`}/>}
    <Text style={styles.small}>Location is reported by the {operator}’s phone and may have changed. With permission, the installed app shares during this active job while in the background or with the screen locked. Phone restrictions or closing the app can interrupt updates. The last location may remain visible for up to one minute if Stop cannot reach the server. {kind === 'food' ? 'The food buyer can follow this delivery.' : ride?.delivery ? 'The sender and the recipient who accepted the private parcel invitation can follow this delivery after collection.' : 'Trip-link recipients can also see it.'}</Text>
    {s.sharing && <Pill>{s.background ? 'THIS PHONE IS SHARING · BACKGROUND ENABLED' : 'THIS PHONE IS SHARING'}</Pill>}
    {data?.isDriver && share?.active && !share.owned && <Text style={styles.body}>Another device or browser is sharing for this trip. You can stop it here before sharing from this phone.</Text>}
    {data?.canShare && !share?.active && !s.sharing && <Button title="Share my location" busy={s.busy} disabled={s.stale || s.loading || s.uncertain} onPress={() => Alert.alert('Share location during this job?', `${audience} Active work requires live location, including while the screen is locked. Next, allow location and background access; Android may open phone settings. Taxi Ai shows a system location indicator or notification while sharing. You can stop at any time. If disconnected, the last location may remain visible for up to one minute.`, [
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
    <Button title="Review work location" secondary onPress={() => router.push({ pathname: c.kind === 'food' ? '/food-order' : '/safety', params: { id: c.id } })}/>
    <Button title="Stop sharing location" secondary onPress={() => void c.stop()}/>
  </SafeAreaView>;
}
export function TripLocationStatus() { const controllers = useTripLocationControllers(); return <>{controllers.map(c => <LocationStatus key={c.clientId} controller={c}/>)}</>; }
