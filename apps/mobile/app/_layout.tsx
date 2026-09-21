import { OperationsProvider, useOperations } from '../src/journeys/provider';
import { TripLocationProvider } from '../src/tracking/provider';
import { TripLocationStatus } from '../src/tracking/view';
import { ArrivalBanner } from '../src/notifications/arrival-banner';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SessionProvider, useSession } from '../src/session/provider';
import { Button, Heading, Loading, Logo, Notice, Screen } from '../src/ui/components';
function Navigation() {
  const { user, ready, blocked, startupError, restore, logout } = useSession();
  const {pushId}=useOperations();
  if (!ready) return <Screen><Logo/><Loading/></Screen>;
  if (startupError) return <Screen><Logo/><Heading title="Let’s reconnect."/><Notice message={startupError}/><Button title="Try again" onPress={() => void restore()}/><Button title="Sign out on this phone" secondary onPress={() => void logout()}/></Screen>;
  return <View style={{ flex: 1 }}><StatusBar style="dark"/><View style={{ flex: 1, opacity: blocked ? 0 : 1 }} pointerEvents={blocked ? 'none' : 'auto'} accessibilityElementsHidden={blocked} importantForAccessibility={blocked ? 'no-hide-descendants' : 'auto'}>{user && !blocked && <><TripLocationStatus/><ArrivalBanner/></>}{user && pushId && !blocked && <Button title="Review journey update" secondary onPress={() => router.push('/updates')}/>}<Stack screenOptions={{ headerShown: false }}>
    <Stack.Protected guard={!!user}><Stack.Screen name="(tabs)"/><Stack.Screen name="safety" options={{ headerShown: true, title: 'Trip safety', headerBackTitle: 'Back' }}/><Stack.Screen name="journey" options={{ headerShown: true, title: 'Your journey', headerBackTitle: 'Back' }}/><Stack.Screen name="book-ride" options={{ headerShown: true, title: 'Book a ride', headerBackTitle: 'Back' }}/><Stack.Screen name="driver-application" options={{ headerShown: true, title: 'Driver application', headerBackTitle: 'Back' }}/></Stack.Protected>
    <Stack.Protected guard={!user}><Stack.Screen name="sign-in"/></Stack.Protected>
  </Stack></View>{blocked && <View style={StyleSheet.absoluteFill}><Screen><Logo/><Loading/></Screen></View>}</View>;
}
function AccountNavigation(){const {user}=useSession();return <TripLocationProvider key={user?.id ?? 'signed-out'}><OperationsProvider><Navigation/></OperationsProvider></TripLocationProvider>;}
export default function RootLayout() { return <SessionProvider><AccountNavigation/></SessionProvider>; }
