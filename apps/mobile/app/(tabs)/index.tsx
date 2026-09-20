import { useState } from 'react';
import { router } from 'expo-router';
import { Text } from 'react-native';
import { useSession } from '../../src/session/provider';
import { Button, Card, Heading, Logo, Notice, Pill, Screen, openWebsite, styles } from '../../src/ui/components';
export default function CustomerHome() {
  const { client, user, setMode } = useSession(), [error, setError] = useState('');
  return <Screen><Logo/><Pill>CUSTOMER · ABUJA</Pill><Heading title={`Hello, ${user?.name.split(' ')[0] ?? 'there'}.`} subtitle="Where will today take you?"/><Notice message={error}/>
    <Card><Text style={styles.h2}>Your ride. Your agreed fare.</Text><Text style={styles.body}>Continue the ride preview on the website while mobile booking takes shape.</Text><Button title="Open web booking" onPress={() => void openWebsite(client.origin).catch(() => setError('Could not open the website.'))}/><Text style={styles.small}>Opens your browser. You may need to sign in there. No live dispatch.</Text></Card>
    <Card><Text style={styles.h2}>Your journeys, together.</Text><Text style={styles.body}>See the ride activity already saved to your account.</Text><Button title="View my activity" secondary onPress={() => { setMode('customer'); router.push('/activity'); }}/></Card>
    <Card><Pill>COMING SOON</Pill><Text style={styles.h2}>Taxi Ai Eats</Text><Text style={styles.body}>Local kitchens. Favourite meals. Motorcycle delivery.</Text></Card>
    <Card><Pill>COMING SOON</Pill><Text style={styles.h2}>Send a parcel</Text><Text style={styles.body}>Motorcycles for small parcels, cars and vans for larger deliveries.</Text></Card>
  </Screen>;
}
