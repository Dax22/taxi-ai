import { useCallback, useRef, useState } from 'react';
import { Text } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useSession } from '../src/session/provider';
import { useResource } from '../src/ui/use-resource';
import { Button, Card, Field, Heading, Loading, Notice, Pill, Screen, openWebsite, readable, styles } from '../src/ui/components';
function ApplicationStatus() {
  const { client } = useSession(), resource = useResource(useCallback(() => client.application(), [client]));
  const [error, setError] = useState('');
  return <><Notice message={resource.error || error}/>{resource.busy ? <Loading/> : <Button title="Refresh application" secondary onPress={resource.reload}/>}
    {resource.value && <Card><Pill>{readable(resource.value.status).toUpperCase()}</Pill><Text style={styles.h2}>{resource.value.vehicle.model}</Text><Text style={styles.body}>{resource.value.vehicle.plate}</Text>
      <Text style={styles.body}>{resource.value.documentCount} documents added.</Text>
      {!!resource.value.eligibility.missing.length && <Text style={styles.body}>Still needed: {resource.value.eligibility.missing.map(readable).join(', ')}.</Text>}
      {!!resource.value.eligibility.expired.length && <Text style={styles.body}>Renew: {resource.value.eligibility.expired.map(readable).join(', ')}.</Text>}
      <Text style={styles.body}>{resource.value.eligibility.eligible ? 'Your application is approved and documents are current.' : 'An approved application and current documents are required before driving.'}</Text>
      <Button title="Continue documents on the website" onPress={() => void openWebsite(client.origin).catch(() => setError('Could not open the website.'))}/><Text style={styles.small}>Sign in there, then choose Work. Document uploads and reviews currently run on the website.</Text>
    </Card>}</>;
}
export default function DriverApplication() {
  const { client, user } = useSession(), [model, setModel] = useState(''), [plate, setPlate] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  async function submit() {
    const vehicle = { model: model.trim(), plate: plate.trim().toUpperCase() }, fingerprint = JSON.stringify(vehicle);
    if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, key: randomUUID() };
    setBusy(true); setError('');
    try { await client.addDriver(vehicle, retry.current.key); retry.current = null; }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start your application.'); }
    finally { setBusy(false); }
  }
  return <Screen><Heading title="Your next opportunity." subtitle="Apply to drive with your existing Taxi Ai account."/><Notice message={error}/>
    {user?.driver ? <ApplicationStatus/> : <Card><Text style={styles.h2}>Start with your vehicle.</Text><Field label="Vehicle model" value={model} onChangeText={setModel} placeholder="Toyota Corolla" maxLength={80} editable={!busy}/><Field label="Number plate" value={plate} onChangeText={setPlate} autoCapitalize="characters" maxLength={15} editable={!busy}/>
      <Text style={styles.body}>This starts an application. Add your documents on the website and receive approval before taking jobs.</Text><Button title="Start application" onPress={() => void submit()} busy={busy} disabled={model.trim().length < 2 || plate.trim().length < 2}/></Card>}
  </Screen>;
}
