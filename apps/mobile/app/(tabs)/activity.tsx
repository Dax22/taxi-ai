import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useSession } from '../../src/session/provider';
import { useResource } from '../../src/ui/use-resource';
import { Button, Card, Heading, Loading, Notice, Pill, Screen, fare, readable, styles } from '../../src/ui/components';
import type { Mode, RideSummary } from '../../../../packages/shared/src/mobile-contracts.mjs';
function RideCard({ ride }: { ride: RideSummary }) {
  return <Card><Pill>{readable(ride.status).toUpperCase()}</Pill><Text style={styles.h2}>{ride.pickup} → {ride.destination}</Text>
    <Text style={styles.body}>{ride.fareKobo === null ? `Suggested fare ${fare(ride.suggestedFareKobo)}` : `Agreed fare ${fare(ride.fareKobo)}`}</Text>
    <Text style={styles.small}>{new Date(ride.createdAt).toLocaleDateString()} · {ride.isDemo ? 'Preview journey' : 'Journey'}</Text>
  </Card>;
}
function Journeys({ mode }: { mode: Mode }) {
  const { client, setMode } = useSession();
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
      {resource.value.activeElsewhere.map((r) => <Card key={r.id}><Text style={styles.body}>You also have an active journey in {r.mode === 'work' ? 'Work' : 'Customer'}.</Text><Button title={`Switch to ${r.mode === 'work' ? 'Work' : 'Customer'}`} secondary onPress={() => setMode(r.mode)}/></Card>)}
      <Text style={styles.h2}>Current journeys</Text>{resource.value.current.length ? resource.value.current.map((r) => <RideCard key={r.id} ride={r}/>) : <Text style={styles.body}>No current journeys in this mode.</Text>}
      <Text style={styles.h2}>Past journeys</Text>{resource.value.history.length || more.length ? [...resource.value.history, ...more].map((r) => <RideCard key={r.id} ride={r}/>) : <Text style={styles.body}>Your completed, cancelled and expired journeys will appear here.</Text>}
      {cursor && <Button title="Load older journeys" secondary busy={busy} onPress={() => void loadMore()}/>}</>}
  </>;
}
export default function Activity() {
  const { user, mode, setMode } = useSession();
  return <Screen><Heading title="Your activity." subtitle="The same saved journeys, across the app and website."/>
    <View style={styles.row}><Button title="Customer" secondary={mode !== 'customer'} onPress={() => setMode('customer')}/>{user?.driver && <Button title="Work" secondary={mode !== 'work'} onPress={() => setMode('work')}/>}</View>
    <Journeys key={`${user?.id}:${mode}`} mode={mode}/>
  </Screen>;
}
