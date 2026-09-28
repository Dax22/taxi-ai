import { Text } from '../ui/typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useOperations } from '../journeys/provider';
import { useSession } from '../session/provider';
import { Button, styles } from '../ui/components';

/** Authenticated inbox data only; a push payload cannot supply vehicle identity. */
export function ArrivalBanner() {
  const { updates } = useOperations();
  const { role } = useSession();
  const notice = updates?.notifications.find(n => n.kind === 'arrive' && n.mode === 'customer'
    && n.arrivalActive && n.readAt === null && updates.serverNow - n.createdAt < 300_000);
  if (role !== 'customer' || !notice) return null;
  return <SafeAreaView edges={['top','left','right']} style={{ padding: 12, gap: 6, backgroundColor: '#fff0bd' }}>
    <Text accessibilityLiveRegion="polite" style={styles.label}>DRIVER HAS ARRIVED</Text>
    <Text style={styles.body} numberOfLines={3}>{notice.body}</Text>
    <Button title="Review arrival details" secondary onPress={() => router.push('/updates')}/>
  </SafeAreaView>;
}
