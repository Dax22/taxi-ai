import { useOperations } from '../../src/journeys/provider';
import { Tabs, router } from 'expo-router';
import { useSession } from '../../src/session/provider';
import { colors } from '../../src/ui/components';
import { TabIcon } from '../../src/ui/tab-icon';
export default function TabLayout() {
  const { setMode } = useSession();
  const { updates } = useOperations();
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.ink, tabBarInactiveTintColor: colors.muted,
    tabBarActiveBackgroundColor: '#fff0bd', tabBarStyle: { backgroundColor: colors.white }, tabBarLabelStyle: { fontSize: 12, fontWeight: '600' } }}>
    <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <TabIcon name="home" color={color}/> }} listeners={{ tabPress: (e) => { e.preventDefault(); void setMode('customer').then((ok) => { if(ok)router.navigate('/'); }); } }}/>
    <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: ({ color }) => <TabIcon name="activity" color={color}/> }}/>
    <Tabs.Screen name="work" options={{ title: 'Work', tabBarIcon: ({ color }) => <TabIcon name="work" color={color}/> }} listeners={{ tabPress: (e) => { e.preventDefault(); void setMode('work').then((ok) => { if(ok)router.navigate('/work'); }); } }}/>
    <Tabs.Screen name="updates" options={{ title: 'Updates', tabBarBadge: updates?.unread ? Math.min(updates.unread,99) : undefined, tabBarIcon: ({ color }) => <TabIcon name="updates" color={color}/> }}/>
    <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: ({ color }) => <TabIcon name="account" color={color}/> }}/>
  </Tabs>;
}
