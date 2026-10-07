import { Text } from './typography';
import { router } from 'expo-router';
import { useSession } from '../session/provider';
import { Button, Card, styles } from './components';
import { VehicleCard } from './vehicle-card';

export function WorkProfileControls() {
  const { user, role } = useSession();
  if (role !== 'driver' || !user?.driver) return null;
  return <Card><Text accessibilityRole="header" style={styles.h2}>Your Driver profile</Text>
    <VehicleCard vehicle={user.driver.vehicle} compact/>
    <Text style={styles.body}>Changed your car? Update the vehicle details and upload its vehicle document and photo. Approval is required before taking new jobs.</Text>
    <Button title="Edit / change vehicle" onPress={() => router.push({ pathname: '/driver-application', params: { section: 'vehicle' } })}/>
    <Button title="Documents and application" secondary onPress={() => router.push('/driver-application')}/>
    <Button title="Delete Driver profile" secondary onPress={() => router.push('/delete-work-profile')}/>
  </Card>;
}
