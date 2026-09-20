import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useSession } from '../../src/session/provider';
import { colors } from '../../src/ui/components';
export default function TabLayout() {
  const { setMode } = useSession();
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.ink, tabBarInactiveTintColor: colors.muted,
    tabBarActiveBackgroundColor: '#fff0bd', tabBarStyle: { backgroundColor: colors.white }, tabBarLabelStyle: { fontSize: 12, fontWeight: '600' } }}>
    <Tabs.Screen name="index" options={{ title: 'Customer', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 22 }}>⌂</Text> }} listeners={{ tabPress: () => setMode('customer') }}/>
    <Tabs.Screen name="work" options={{ title: 'Work', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 22 }}>↗</Text> }} listeners={{ tabPress: () => setMode('work') }}/>
    <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 22 }}>≡</Text> }}/>
    <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 22 }}>◎</Text> }}/>
  </Tabs>;
}
