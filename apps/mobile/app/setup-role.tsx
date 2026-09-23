import { useState } from 'react';
import { Text } from '../src/ui/typography';
import { useSession } from '../src/session/provider';
import type { AppRole } from '../src/session/secure-vault';
import { Button, Card, Heading, Logo, Notice, Pill, Screen, styles } from '../src/ui/components';

export default function SetupRole() {
  const { chooseRole, notice } = useSession();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function select(role: AppRole) {
    if (busy) return;
    setBusy(true); setError('');
    try { await chooseRole(role); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your choice. Try again.'); }
    finally { setBusy(false); }
  }
  return <Screen><Logo/><Pill>SET UP YOUR APP</Pill>
    <Heading title="How will you use Taxi Ai?" subtitle="Choose the experience for this account on this phone."/>
    <Notice message={error || notice}/>
    <Card><Text style={styles.h2}>Customer</Text><Text style={styles.body}>Book rides and deliveries, track your journeys and order with Eats.</Text>
      <Button title="Continue as Customer" busy={busy} onPress={() => void select('customer')}/></Card>
    <Card><Text style={styles.h2}>Driver</Text><Text style={styles.body}>Apply to drive or deliver, manage your vehicle and receive nearby requests after approval.</Text>
      <Button title="Continue as Driver" secondary disabled={busy} onPress={() => void select('driver')}/></Card>
    <Text style={styles.small}>Your choice is saved for this account. The app will open directly to your selected experience next time.</Text>
  </Screen>;
}
