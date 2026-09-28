import { useState } from 'react';
import { Redirect, router } from 'expo-router';
import { Text } from '../../src/ui/typography';
import { useSession } from '../../src/session/provider';
import { Button, Card, Heading, Logo, Pill, Screen, styles } from '../../src/ui/components';
import { VehicleCategories } from '../../src/ui/vehicle-categories';
import { vehicleCategory } from '../../../../packages/shared/src/vehicle-categories.mjs';
import type { VehicleCategoryId } from '../../../../packages/shared/src/vehicle-categories.mjs';
export default function CustomerHome() {
  const { user, role } = useSession();
  const [categoryId, setCategoryId] = useState<VehicleCategoryId>('standard');
  if (role === 'driver') return <Redirect href="/work"/>;
  return <Screen><Logo/><Pill>CUSTOMER · NIGERIA</Pill><Heading title={`Hello, ${user?.name.split(' ')[0] ?? 'there'}.`} subtitle="Where will today take you?"/>
    <VehicleCategories value={categoryId} onChange={setCategoryId}/>
    {vehicleCategory(categoryId)?.ridePreview && <Card><Text style={styles.h2}>{categoryId === 'standard' || categoryId === 'suv' ? 'Your ride. Your agreed fare.' : 'Your parcel. Your agreed fare.'}</Text><Text style={styles.body}>Choose a route in Nigeria, review the suggested fare and request a nearby driver.</Text><Button title={`Book ${vehicleCategory(categoryId)?.name}`} onPress={() => router.push({ pathname: '/book-ride', params: { category: categoryId } })}/><Text style={styles.small}>Agree your fare, chat and follow the journey here in the app. Development preview · no live dispatch.</Text></Card>}
    <Card><Text style={styles.h2}>Your journeys, together.</Text><Text style={styles.body}>See the ride activity already saved to your account.</Text><Button title="View my activity" secondary onPress={() => router.push('/activity')}/></Card>
    <Card><Pill>TAXI AI EATS</Pill><Text style={styles.h2}>Your next favourite meal.</Text><Text style={styles.body}>Discover restaurants and home kitchens. Order delivery or collect it yourself.</Text><Button title="Explore Taxi Ai Eats" onPress={() => router.push('/eats')}/><Text style={styles.small}>Food ordering preview · test checkout, no charge.</Text></Card>
    <Card><Pill>TAXI AI COURIER</Pill><Text style={styles.h2}>Send a parcel</Text><Text style={styles.body}>Cars and motorcycles for small parcels, vans for larger deliveries, and trucks for cargo. Invite your recipient to track the delivery in their account.</Text><Button title="Send a parcel" onPress={() => router.push({ pathname: '/book-ride', params: { category: 'motorcycle', service: 'courier' } })}/><Button title="Track a parcel sent to me" secondary onPress={() => router.push('/parcels')}/></Card>
  </Screen>;
}
