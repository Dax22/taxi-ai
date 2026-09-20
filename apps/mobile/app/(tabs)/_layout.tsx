import { Tabs } from 'expo-router';
import { useSession } from '../../src/session/provider';
import { colors } from '../../src/ui/components';
import { TabIcon } from '../../src/ui/tab-icon';
export default function TabLayout() {
  const { setMode } = useSession();
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.ink, tabBarInactiveTintColor: colors.muted,
    tabBarActiveBackgroundColor: '#fff0bd', tabBarStyle: { backgroundColor: colors.white }, tabBarLabelStyle: { fontSize: 12, fontWeight: '600' } }}>
    <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <TabIcon name="home" color={color}/> }} listeners={{ tabPress: () => setMode('customer') }}/>
    <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: ({ color }) => <TabIcon name="activity" color={color}/> }}/>
    <Tabs.Screen name="work" options={{ title: 'Work', tabBarIcon: ({ color }) => <TabIcon name="work" color={color}/> }} listeners={{ tabPress: () => setMode('work') }}/>
    <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: ({ color }) => <TabIcon name="account" color={color}/> }}/>
  </Tabs>;
}
