import '../src/tracking/background-task';
import { useEffect } from 'react';
import { OperationsProvider, useOperations } from '../src/journeys/provider';
import { TripLocationProvider } from '../src/tracking/provider';
import { TripLocationStatus } from '../src/tracking/view';
import { ArrivalBanner } from '../src/notifications/arrival-banner';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { useFonts } from '@expo-google-fonts/manrope/useFonts';
import { Manrope_400Regular } from '@expo-google-fonts/manrope/400Regular';
import { Manrope_500Medium } from '@expo-google-fonts/manrope/500Medium';
import { Manrope_600SemiBold } from '@expo-google-fonts/manrope/600SemiBold';
import { Manrope_700Bold } from '@expo-google-fonts/manrope/700Bold';
import { Manrope_800ExtraBold } from '@expo-google-fonts/manrope/800ExtraBold';
import { SessionProvider, useSession } from '../src/session/provider';
import { EatsProvider } from '../src/eats/provider';
import { fontFamily, fontFamilySemiBold } from '../src/ui/typography';
import { Button, Heading, Loading, Logo, Notice, Screen } from '../src/ui/components';
import { KemmySetupAssistant } from '../src/kemmy/setup-assistant';
function Navigation() {
  const { user, role, ready, setupLoading, blocked, startupError, restore, logout, startingExperience, consumeStartingExperience } = useSession();
  const {pushId,familyPushId,dismissFamilyPush,deliveryPushId}=useOperations();
  useEffect(() => {
    if (!user || !role || blocked || !startingExperience) return;
    consumeStartingExperience();
    if (startingExperience === 'driver') router.replace('/driver-application');
    else if (startingExperience === 'eats_seller') router.replace('/my-store');
  }, [user?.id, role, blocked, startingExperience, consumeStartingExperience]);
  if (!ready || setupLoading) return <Screen><Logo/><Loading/></Screen>;
  if (startupError) return <Screen><Logo/><Heading title="Let’s reconnect."/><Notice message={startupError}/><Button title="Try again" onPress={() => void restore()}/><Button title="Sign out on this phone" secondary onPress={() => void logout()}/></Screen>;
  return <View style={{ flex: 1 }}><StatusBar style="dark"/><View style={{ flex: 1, opacity: blocked ? 0 : 1 }} pointerEvents={blocked ? 'none' : 'auto'} accessibilityElementsHidden={blocked} importantForAccessibility={blocked ? 'no-hide-descendants' : 'auto'}>{user && role && !blocked && <><TripLocationStatus/><ArrivalBanner/></>}{user && role && deliveryPushId && !blocked && <Button title="Review Kemmy delivery update" secondary onPress={() => router.push('/updates')}/>}{user && role && pushId && !blocked && <Button title="Review journey update" secondary onPress={() => router.push('/updates')}/>}{user && role && familyPushId && !blocked && <Button title="Review Family Safety update" secondary onPress={() => { dismissFamilyPush(); router.push('/family'); }}/>}<Stack screenOptions={{ headerShown: false, headerTitleStyle: { fontFamily: fontFamilySemiBold, fontWeight: 'normal' }, headerBackTitleStyle: { fontFamily } }}>
    <Stack.Protected guard={!!user && !!role}><Stack.Screen name="(tabs)"/><Stack.Screen name="family" options={{ headerShown: true, title: 'Family Safety', headerBackTitle: 'Back' }}/><Stack.Screen name="food-order" options={{ headerShown: true, title: 'Food order', headerBackTitle: 'Back' }}/><Stack.Screen name="safety" options={{ headerShown: true, title: 'Trip safety', headerBackTitle: 'Back' }}/><Stack.Screen name="journey" options={{ headerShown: true, title: 'Your journey', headerBackTitle: 'Back' }}/></Stack.Protected>
    <Stack.Protected guard={!!user && role === 'customer'}><Stack.Screen name="parcels" options={{ headerShown: true, title: 'Incoming parcels', headerBackTitle: 'Back' }}/><Stack.Screen name="eats" options={{ headerShown: true, title: 'Taxi Ai Eats', headerBackTitle: 'Back' }}/><Stack.Screen name="my-store" options={{ headerShown: true, title: 'Seller hub', headerBackTitle: 'Back' }}/><Stack.Screen name="book-ride" options={{ headerShown: true, title: 'Book a ride', headerBackTitle: 'Back' }}/></Stack.Protected>
    <Stack.Protected guard={!!user && role === 'driver'}><Stack.Screen name="food-work" options={{ headerShown: true, title: 'Food deliveries', headerBackTitle: 'Back' }}/><Stack.Screen name="earnings" options={{ headerShown: true, title: 'Earnings', headerBackTitle: 'Back' }}/><Stack.Screen name="delete-work-profile" options={{ headerShown: true, title: 'Delete Driver profile', headerBackTitle: 'Back' }}/><Stack.Screen name="driver-application" options={{ headerShown: true, title: 'Driver application', headerBackTitle: 'Back' }}/></Stack.Protected>
    <Stack.Protected guard={!!user && !role}><Stack.Screen name="setup-role"/></Stack.Protected>
    <Stack.Protected guard={!user}><Stack.Screen name="sign-in"/></Stack.Protected>
  </Stack></View>{user && !blocked && <KemmySetupAssistant/>}{blocked && <View style={StyleSheet.absoluteFill}><Screen><Logo/><Loading/></Screen></View>}</View>;
}
function AccountNavigation(){const {user}=useSession();return <TripLocationProvider key={user?.id ?? 'signed-out'}><EatsProvider><OperationsProvider><Navigation/></OperationsProvider></EatsProvider></TripLocationProvider>;}
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold });
  if (fontError) throw fontError;
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#f6f6f2' }}/>;
  return <SessionProvider><AccountNavigation/></SessionProvider>;
}
