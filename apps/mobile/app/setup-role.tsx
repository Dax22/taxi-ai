import { useState } from 'react';
import { router } from 'expo-router';
import { Text } from '../src/ui/typography';
import { useSession } from '../src/session/provider';
import type { AppRole } from '../src/session/secure-vault';
import { Button, Card, Heading, Logo, Notice, Pill, Screen, styles } from '../src/ui/components';

export default function SetupRole() {
  const { chooseRole, notice } = useSession();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function select(role: AppRole, destination?: '/my-store') {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await chooseRole(role);
      if (destination) router.replace(destination);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your choice. Try again.'); }
    finally { setBusy(false); }
  }
  return <Screen><Logo/><Pill>SET UP YOUR APP</Pill>
    <Heading title="How would you like to start?" subtitle="One Taxi Ai account can book, drive or sell food. Choose your starting experience on this phone."/>
    <Notice message={error || notice}/>
    <Card><Text style={styles.h2}>Book & Order</Text><Text style={styles.body}>Book rides, send parcels, track journeys and order with Eats.</Text>
      <Button title="Start with Book & Order" busy={busy} onPress={() => void select('customer')}/></Card>
    <Card><Text style={styles.h2}>Drive & Deliver</Text><Text style={styles.body}>Apply to drive or deliver, manage your vehicle and receive work after approval.</Text>
      <Button title="Start with Drive & Deliver" secondary disabled={busy} onPress={() => void select('driver')}/></Card>
    <Card><Text style={styles.h2}>Sell Food</Text><Text style={styles.body}>Create a restaurant, food business or private-kitchen storefront with the same login.</Text>
      <Button title="Start with Sell Food" secondary disabled={busy} onPress={() => void select('customer','/my-store')}/></Card>
    <Text style={styles.small}>This choice changes only where the app starts. It does not create a separate account or stop you adding another Taxi Ai service later.</Text>
  </Screen>;
}
