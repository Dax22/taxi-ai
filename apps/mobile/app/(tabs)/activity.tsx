import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Text } from '../../src/ui/typography';
import { useSession } from '../../src/session/provider';
import { useResource } from '../../src/ui/use-resource';
import { Button, Card, Heading, Loading, Notice, Pill, Screen, fare, readable, styles } from '../../src/ui/components';
import { vehicleCategory } from '../../../../packages/shared/src/vehicle-categories.mjs';
import type { Mode, RideSummary } from '../../../../packages/shared/src/mobile-contracts.mjs';
import { VehicleCard } from '../../src/ui/vehicle-card';
import { PassengerSummary } from '../../src/guest-rides/passenger-summary';
function RideCard({ ride, mode }: { ride: RideSummary; mode: Mode }) {
  const [showVehicle, setShowVehicle] = useState(false);
  return <Card><Pill>{readable(ride.status).toUpperCase()}</Pill><Text style={styles.h2}>{ride.pickup} → {ride.destination}</Text>
    <PassengerSummary passenger={ride.passenger} bookedBy={mode === 'customer' ? 'You' : 'Customer account'}/>
    <Text style={styles.small}>{ride.service === 'delivery' ? 'Parcel delivery · ' : ''}{vehicleCategory(ride.vehicleCategory ?? 'standard')?.name}</Text><Text style={styles.body}>{ride.fareKobo === null ? `Suggested fare ${fare(ride.suggestedFareKobo)}` : `Agreed fare ${fare(ride.fareKobo)}`}</Text>
    <Text style={styles.small}>{new Date(ride.createdAt).toLocaleDateString()} · {ride.isDemo ? 'Preview journey' : 'Journey'}</Text>
    {ride.driver && <><Button title={showVehicle ? 'Hide vehicle details' : 'View vehicle details'} secondary onPress={() => setShowVehicle((v) => !v)}/>
      {showVehicle && <><Text style={styles.body}>Driver: {ride.driver.name}</Text><VehicleCard vehicle={ride.driver.vehicle} label="VEHICLE FOR THIS JOURNEY" compact/></>}</>}
    <Button title="Open journey" onPress={() => router.push({ pathname: '/journey', params: { id: ride.id } })}/>
  </Card>;
}
function Journeys({ mode }: { mode: Mode }) {
  const { client } = useSession();
  const resource = useResource(useCallback(async () => { await client.session(); return client.activity(mode); }, [client, mode]));
  const [more, setMore] = useState<RideSummary[]>([]), [cursor, setCursor] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => { generation.current++; setMore([]); setCursor(resource.value?.nextBefore ?? null); setBusy(false); setError(''); return () => { generation.current++; }; }, [resource.value]);
  async function loadMore() {
    if (!cursor || busy) return;
    const epoch = generation.current; setBusy(true); setError('');
    try { const page = await client.activity(mode, cursor); if (epoch === generation.current) { setMore((old) => [...old, ...page.history.filter((r) => !old.some((saved) => saved.id === r.id))]); setCursor(page.nextBefore); } }
    catch (e) { if (epoch === generation.current) setError(e instanceof Error ? e.message : 'Unable to load older journeys.'); }
    finally { if (epoch === generation.current) setBusy(false); }
  }
  return <><Notice message={resource.error || error}/>{resource.busy ? <Loading/> : <Button title="Refresh activity" secondary onPress={resource.reload}/>}
    {resource.value && <><Text style={styles.small}>Updated from your account. Refresh to see changes.</Text>
      {resource.value.activeElsewhere.map((r) => <Card key={r.id}><Text style={styles.body}>You also have an active {r.mode === 'work' ? 'driver job' : 'customer journey'} on this account. View it on the website.</Text></Card>)}
      <Text style={styles.h2}>Current journeys</Text>{mode === 'customer' && <Button title="Manage ride requests" secondary onPress={() => router.push('/book-ride')}/>}{resource.value.current.length ? resource.value.current.map((r) => <RideCard key={r.id} ride={r} mode={mode}/>) : <Text style={styles.body}>No current journeys yet.</Text>}
      <Text style={styles.h2}>Past journeys</Text>{resource.value.history.length || more.length ? [...resource.value.history, ...more].map((r) => <RideCard key={r.id} ride={r} mode={mode}/>) : <Text style={styles.body}>Your completed, cancelled and expired journeys will appear here.</Text>}
      {cursor && <Button title="Load older journeys" secondary busy={busy} onPress={() => void loadMore()}/>}</>}
  </>;
}
export default function Activity() {
  const { user, role, mode } = useSession();
  return <Screen><Heading title="Your activity." subtitle="The same saved journeys, across the app and website."/>
    {role === 'customer' && <Button title="Parcels sent to me" secondary onPress={() => router.push('/parcels')}/>}
    {role === 'customer' && <Card><Text style={styles.h2}>Taxi Ai Eats orders</Text><Text style={styles.body}>Track your food, view past orders and check handover details.</Text><Button title="My food orders" secondary onPress={() => router.push({ pathname: '/eats', params: { section: 'orders' } })}/></Card>}
    {role === 'driver' && !user?.driver ? <Card><Text style={styles.h2}>Complete your Driver setup</Text><Text style={styles.body}>Your driver journeys will appear here after you create your driver profile.</Text><Button title="Start driver application" onPress={() => router.push('/driver-application')}/></Card>
      : <Journeys key={`${user?.id}:${mode}`} mode={mode}/>}
  </Screen>;
}
