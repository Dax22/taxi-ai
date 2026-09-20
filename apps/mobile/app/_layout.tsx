import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider, useSession } from '../src/session/provider';
import { Button, Heading, Loading, Logo, Notice, Screen } from '../src/ui/components';
function Navigation() {
  const { user, ready, blocked, startupError, restore, logout } = useSession();
  if (!ready || blocked) return <Screen><Logo/><Loading/></Screen>;
  if (startupError) return <Screen><Logo/><Heading title="Let’s reconnect."/><Notice message={startupError}/><Button title="Try again" onPress={() => void restore()}/><Button title="Sign out on this phone" secondary onPress={() => void logout()}/></Screen>;
  return <><StatusBar style="dark"/><Stack screenOptions={{ headerShown: false }}>
    <Stack.Protected guard={!!user}><Stack.Screen name="(tabs)"/><Stack.Screen name="driver-application" options={{ headerShown: true, title: 'Driver application', headerBackTitle: 'Back' }}/></Stack.Protected>
    <Stack.Protected guard={!user}><Stack.Screen name="sign-in"/></Stack.Protected>
  </Stack></>;
}
export default function RootLayout() { return <SessionProvider><Navigation/></SessionProvider>; }
