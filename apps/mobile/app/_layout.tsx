import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SessionProvider, useSession } from '../src/session/provider';
import { Button, Heading, Loading, Logo, Notice, Screen } from '../src/ui/components';
function Navigation() {
  const { user, ready, blocked, startupError, restore, logout } = useSession();
  if (!ready) return <Screen><Logo/><Loading/></Screen>;
  if (startupError) return <Screen><Logo/><Heading title="Let’s reconnect."/><Notice message={startupError}/><Button title="Try again" onPress={() => void restore()}/><Button title="Sign out on this phone" secondary onPress={() => void logout()}/></Screen>;
  return <View style={{ flex: 1 }}><StatusBar style="dark"/><View style={{ flex: 1, opacity: blocked ? 0 : 1 }} pointerEvents={blocked ? 'none' : 'auto'} accessibilityElementsHidden={blocked} importantForAccessibility={blocked ? 'no-hide-descendants' : 'auto'}><Stack screenOptions={{ headerShown: false }}>
    <Stack.Protected guard={!!user}><Stack.Screen name="(tabs)"/><Stack.Screen name="driver-application" options={{ headerShown: true, title: 'Driver application', headerBackTitle: 'Back' }}/></Stack.Protected>
    <Stack.Protected guard={!user}><Stack.Screen name="sign-in"/></Stack.Protected>
  </Stack></View>{blocked && <View style={StyleSheet.absoluteFill}><Screen><Logo/><Loading/></Screen></View>}</View>;
}
export default function RootLayout() { return <SessionProvider><Navigation/></SessionProvider>; }
