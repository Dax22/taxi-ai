import { useOperations } from '../../src/journeys/provider';
import { Tabs } from 'expo-router';
import { useSession } from '../../src/session/provider';
import { colors } from '../../src/ui/components';
import { TabIcon } from '../../src/ui/tab-icon';
import { fontFamilySemiBold } from '../../src/ui/typography';
export default function TabLayout() {
  const { role, mode } = useSession();
  const { updates, deliveryUpdates } = useOperations();
  const unread = (updates?.notifications.filter((notice) => notice.mode === mode && notice.readAt === null).length ?? 0) + (deliveryUpdates?.unread ?? 0);
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.ink, tabBarInactiveTintColor: colors.muted,
    tabBarActiveBackgroundColor: '#fff0bd', tabBarStyle: { backgroundColor: colors.white }, tabBarLabelStyle: { fontFamily: fontFamilySemiBold, fontSize: 12, fontWeight: 'normal' } }}>
    <Tabs.Screen name="index" options={{ title: 'Home', href: role === 'driver' ? null : undefined, tabBarIcon: ({ color }) => <TabIcon name="home" color={color}/> }}/>
    <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: ({ color }) => <TabIcon name="activity" color={color}/> }}/>
    <Tabs.Screen name="work" options={{ title: 'Driver', href: role === 'customer' ? null : undefined, tabBarIcon: ({ color }) => <TabIcon name="work" color={color}/> }}/>
    <Tabs.Screen name="updates" options={{ title: 'Updates', tabBarBadge: unread ? Math.min(unread,99) : undefined, tabBarIcon: ({ color }) => <TabIcon name="updates" color={color}/> }}/>
    <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: ({ color }) => <TabIcon name="account" color={color}/> }}/>
  </Tabs>;
}
