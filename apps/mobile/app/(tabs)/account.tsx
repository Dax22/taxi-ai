import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { Text } from '../../src/ui/typography';
import { router } from 'expo-router';
import { WorkProfileControls } from '../../src/ui/work-profile-controls';
import { useSession } from '../../src/session/provider';
import { useResource } from '../../src/ui/use-resource';
import { EmailVerification } from '../../src/ui/email-verification';
import { Button, Card, Heading, Loading, Notice, Pill, Screen, openWebsite, styles } from '../../src/ui/components';
export default function Account() {
  const { client, user, logout } = useSession();
  const resource = useResource(useCallback(() => client.devices(), [client]));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function revoke(id: string) {
    setBusy(true); setError('');
    try { await client.revoke(id); resource.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not sign out this device.'); }
    finally { setBusy(false); }
  }
  return <Screen><Heading title="Your account." subtitle="One profile. Every service."/><Notice message={error || resource.error}/>
    <Card><Text style={styles.h2}>{user?.name}</Text><Text style={styles.body}>{user?.email}</Text><Text style={styles.small}>Customer{user?.driver ? ' · Driver profile' : ''}</Text><Button title="Open web account" secondary onPress={() => void openWebsite(client.origin).catch(() => setError('Could not open the website.'))}/></Card>
    <WorkProfileControls/>
    <Card><Text style={styles.h2}>My store · Taxi Ai Eats</Text><Text style={styles.body}>Sell your home cooking or run a restaurant. Manage your menu, batch portions and food orders using this account.</Text><Button title="Open My store" onPress={() => router.push('/my-store')}/><Button title="Sell from home" secondary onPress={() => router.push({ pathname: '/my-store', params: { type: 'home_kitchen' } })}/></Card>
    <EmailVerification client={client}/>
    <Text style={styles.h2}>Signed-in devices</Text><Text style={styles.body}>Device names are labels you chose. Sign out anything you no longer use.</Text>
    {resource.busy ? <Loading/> : <Button title="Refresh devices" secondary onPress={resource.reload}/>}
    {resource.value?.map((d) => <Card key={d.id}>{d.current && <Pill>THIS DEVICE</Pill>}<Text style={styles.h2}>{d.name}</Text><Text style={styles.small}>Signed in {new Date(d.createdAt).toLocaleDateString()} · Last session renewal {new Date(d.refreshedAt).toLocaleString()}</Text>
      {!d.current && <Button title="Sign out this device" secondary disabled={busy} onPress={() => Alert.alert('Sign out this device?', d.name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void revoke(d.id) }])}/>}</Card>)}
    <Button title="Sign out on this phone" secondary disabled={busy} onPress={() => void logout()}/>
    <Text style={styles.small}>App preview 0.8.0 · No live dispatch, payments or emergency response.</Text>
  </Screen>;
}
