import { useState } from 'react';
import { router } from 'expo-router';
import { Text } from 'react-native';
import { useSession } from '../../src/session/provider';
import { Button, Card, Heading, Logo, Notice, Pill, Screen, openWebsite, styles } from '../../src/ui/components';
export default function CustomerHome() {
  const { client, user, setMode } = useSession(), [error, setError] = useState('');
  return <Screen><Logo/><Pill>CUSTOMER · ABUJA</Pill><Heading title={`Hello, ${user?.name.split(' ')[0] ?? 'there'}.`} subtitle="Where will today take you?"/><Notice message={error}/>
    <Card><Text style={styles.h2}>Your ride. Your agreed fare.</Text><Text style={styles.body}>Choose an Abuja route, review the suggested fare and request a driver.</Text><Button title="Book a ride" onPress={() => { setMode('customer'); router.push('/book-ride'); }}/><Button title="Continue on website" secondary onPress={() => void openWebsite(client.origin).catch(() => setError('Could not open the website.'))}/><Text style={styles.small}>Development preview · no live dispatch. Negotiation and trip controls continue on the website with the same account.</Text></Card>
    <Card><Text style={styles.h2}>Your journeys, together.</Text><Text style={styles.body}>See the ride activity already saved to your account.</Text><Button title="View my activity" secondary onPress={() => { setMode('customer'); router.push('/activity'); }}/></Card>
    <Card><Pill>COMING SOON</Pill><Text style={styles.h2}>Taxi Ai Eats</Text><Text style={styles.body}>Local kitchens. Favourite meals. Motorcycle delivery.</Text></Card>
    <Card><Pill>COMING SOON</Pill><Text style={styles.h2}>Send a parcel</Text><Text style={styles.body}>Motorcycles for small parcels, cars and vans for larger deliveries.</Text></Card>
  </Screen>;
}
