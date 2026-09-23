import { useEffect, useState } from 'react';
import { Text } from '../src/ui/typography';
import { router } from 'expo-router';
import { useSession } from '../src/session/provider';
import { useDriverOnboarding } from '../src/onboarding/use-onboarding';
import { Button, Card, Field, Heading, Loading, Notice, Screen, styles } from '../src/ui/components';

function DeleteProfile() {
  const f = useDriverOnboarding(), [confirmation, setConfirmation] = useState('');
  useEffect(() => { setConfirmation(''); }, [f.application?.version, f.loading]);
  return <Screen><Heading title="Delete your Driver profile?"/>
    <Card><Text style={styles.body}>This takes you offline and removes your current driver details, vehicle and uploaded documents. Your account stays open.</Text>
      <Text style={styles.body}>Past trips, receipts, safety reports and review records are retained. Copies in backups or already downloaded are not erased by this action.</Text>
      <Text style={styles.body}>You can apply again later with new documents and a new review. To change cars, use Edit / change vehicle instead.</Text></Card>
    <Notice message={f.error}/>
    {f.loading ? <Loading/> : !f.application ? <Text style={styles.body}>You have no active Driver profile.</Text> : <>
      {f.application.busy && <Notice message="Finish or cancel assigned jobs before deleting your Driver profile."/>}
      {f.stale && <Notice message="Your profile changed. Refresh it and confirm deletion again."/>}
      <Field label="Type DELETE to confirm" value={confirmation} onChangeText={setConfirmation} autoCapitalize="characters" autoCorrect={false} maxLength={6} editable={!f.pending && !f.stale && !f.application.busy}/>
      <Button title="Confirm delete Driver profile" disabled={confirmation !== 'DELETE' || f.stale || f.application.busy} busy={f.pending}
        onPress={() => void f.deleteProfile(confirmation, () => router.replace('/(tabs)/account'))}/>
    </>}
    <Button title="Refresh Driver profile" secondary disabled={f.pending} onPress={() => { setConfirmation(''); void f.reload(); }}/>
    <Button title="Keep my account and go back" secondary disabled={f.pending} onPress={() => router.back()}/>
  </Screen>;
}
export default function DeleteWorkProfile() {
  const { user } = useSession();
  return user ? <DeleteProfile key={user.id}/> : null;
}
