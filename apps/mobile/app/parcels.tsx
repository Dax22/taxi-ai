import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useSession } from '../src/session/provider';
import { ParcelsController } from '../src/parcels/controller';
import { useParcelFocus } from '../src/parcels/use-focus';
import { NativeMap } from '../src/maps/native-map';
import { VehicleCard } from '../src/ui/vehicle-card';
import { Text } from '../src/ui/typography';
import { Button, Card, Field, Heading, Loading, Notice, Pill, Screen, readable, styles } from '../src/ui/components';

function IncomingParcels() {
  const { client, user, mode, blocked } = useSession();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const consumed = useRef('');
  const controller = useMemo(() => new ParcelsController(client, randomUUID), [client, user?.id, mode]);
  const s = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useParcelFocus(controller);
  useEffect(() => {
    if (typeof token === 'string' && token !== consumed.current && s.loading && !blocked) {
      consumed.current = token; controller.editInvitation(token); router.setParams({ token: undefined });
    }
  }, [token, s.loading, blocked, controller]);
  const parcel = blocked ? null : s.selected, position = parcel?.location;
  const stalePosition = position ? s.stale || s.now - position.capturedAt >= 30_000 : false;
  return <Screen><Pill>TAXI AI COURIER</Pill><Heading title="Parcels sent to you." subtitle="Accept your sender’s invitation to track a parcel securely in your account."/>
    <Notice message={s.error}/>{s.notice && <Text accessibilityLiveRegion="polite" style={styles.body}>{s.notice}</Text>}
    <Card><Text style={styles.h2}>Accept a parcel invitation</Text>
      <Text style={styles.body}>Paste the private link your sender shared. Accept only if you are the intended recipient. This invitation will be linked to your signed-in account.</Text>
      <Field label="Private parcel link or invitation code" value={s.invitation} onChangeText={value => controller.editInvitation(value)} maxLength={2048} autoCapitalize="none" autoCorrect={false} editable={!s.busy && !s.uncertain && !blocked}/>
      <Button title="Accept invitation for my account" busy={s.busy} disabled={blocked || s.uncertain || !s.invitation.trim()} onPress={() => void controller.accept()}/>
      {s.uncertain && <Button title="Retry the same invitation" secondary busy={s.busy} onPress={() => void controller.retry()}/>}
    </Card>
    <Button title="Refresh my parcels" secondary busy={s.loading} disabled={s.busy || blocked} onPress={() => void controller.refresh()}/>
    {s.loading && !s.parcels.length && <Loading/>}
    {!s.loading && !s.parcels.length && <Text style={styles.body}>{s.stale ? 'Connect to refresh your parcels and confirm access.' : 'No accepted parcel invitations yet.'}</Text>}
    {!blocked && s.parcels.map(item => <Card key={item.rideId}><Pill>{readable(item.status).toUpperCase()}</Pill><Text style={styles.h2}>{item.description}</Text><Text style={styles.body}>{item.reference} · To {item.destination}</Text><Button title={s.selectedId === item.rideId ? 'Refresh parcel details' : 'Track this parcel'} secondary disabled={s.busy || s.uncertain} onPress={() => controller.select(item.rideId)}/></Card>)}
    {parcel && <Card><Pill>{parcel.reference}</Pill><Heading title={parcel.description} subtitle={readable(parcel.status)}/>
      <Text style={styles.body}>Recipient · {parcel.recipientName}</Text><Text style={styles.body}>Delivery to · {parcel.destination}</Text><Text style={styles.small}>Parcel weight · {parcel.weightKg} kg</Text>
      {parcel.driver && <><Text style={styles.body}>Driver · {parcel.driver.name}</Text><VehicleCard vehicle={parcel.driver.vehicle} compact label="DELIVERY VEHICLE"/></>}
      {position ? <><Pill>{stalePosition ? 'LAST KNOWN LOCATION' : 'RECENT DRIVER LOCATION'}</Pill><Text style={styles.body}>Recorded {new Date(position.capturedAt).toLocaleTimeString()} · accuracy {Math.round(position.accuracy)} m</Text>
        <NativeMap pins={[{ id: 'driver', lat: position.lat, lng: position.lng, title: stalePosition ? 'Last known parcel location' : 'Driver carrying your parcel', stale: stalePosition }]} summary="Driver-shared location for your parcel."/>
      </> : <Text style={styles.body}>{parcel.status === 'in_progress' ? 'Waiting for a recent location from the driver’s phone.' : parcel.status === 'completed' ? 'Delivery completed. Location sharing has ended.' : 'Driver location appears after the parcel is collected and the driver shares a recent position.'}</Text>}
      {parcel.dropoffPin && <><Text style={styles.label}>YOUR DELIVERY CODE</Text><Text selectable style={styles.title}>{parcel.dropoffPin}</Text><Text style={styles.body}>Give this code to the driver only after you receive and check your parcel. It confirms the handover.</Text></>}
      {parcel.verifiedAt && <Text style={styles.body}>Handover confirmed {new Date(parcel.verifiedAt).toLocaleString()}.</Text>}
    </Card>}
    <Text style={styles.small}>Tracking refreshes every five seconds while this screen is open. Location depends on the driver sharing from their phone; it is never simulated.</Text>
  </Screen>;
}
export default function Parcels() { const { user, role } = useSession(); return role === 'driver' ? <Redirect href="/work"/> : user ? <IncomingParcels key={user.id}/> : null; }
