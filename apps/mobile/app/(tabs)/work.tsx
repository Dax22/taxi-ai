import { useCallback } from 'react';
import { router } from 'expo-router';
import { Text } from 'react-native';
import { useSession } from '../../src/session/provider';
import { useResource } from '../../src/ui/use-resource';
import { Button, Card, Heading, Loading, Notice, Pill, Screen, readable, styles } from '../../src/ui/components';
import { VehicleCard } from '../../src/ui/vehicle-card';
export default function Work() {
  const { client, setMode } = useSession(), resource = useResource(useCallback(() => client.session(), [client]));
  const user = resource.value;
  return <Screen><Pill>WORK · ONE ACCOUNT</Pill><Heading title="Make your move." subtitle="Your work profile stays separate from your personal journeys."/><Notice message={resource.error}/>
    {resource.busy ? <Loading/> : <><Button title="Refresh work profile" secondary onPress={resource.reload}/>{user && <Card><Text style={styles.h2}>{user.driver ? 'Your driver profile' : 'Drive with Taxi Ai'}</Text>
      {user.driver ? <VehicleCard vehicle={user.driver.vehicle} compact/> : <Text style={styles.body}>Start a driver application with your existing account.</Text>}
      {user.driver && <><Pill>{readable(user.driver.status).toUpperCase()}</Pill><Text style={styles.body}>{user.driver.eligibility.eligible ? 'Your documents and approval are current. Native job controls are coming in the next mobile milestone.' : 'Complete your application and receive approval before taking jobs.'}</Text></>}
      <Button title={user.driver ? 'View driver application' : 'Start driver application'} onPress={() => router.push('/driver-application')}/>
      {user.driver && <Button title="View work activity" secondary onPress={() => { setMode('work'); router.push('/activity'); }}/>}</Card>}</>}
    <Card><Pill>COMING SOON</Pill><Text style={styles.h2}>Deliver or run a kitchen.</Text><Text style={styles.body}>Motorcycle and car delivery profiles, plus a Taxi Ai Eats vendor workspace, will join this account.</Text></Card>
  </Screen>;
}
