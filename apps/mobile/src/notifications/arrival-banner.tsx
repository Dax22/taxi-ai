import { Text } from '../ui/typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useOperations } from '../journeys/provider';
import { useSession } from '../session/provider';
import { Button, styles } from '../ui/components';

/** Authenticated inbox data only; a push payload cannot supply vehicle identity. */
export function ArrivalBanner() {
  const { updates, deliveryUpdates } = useOperations();
  const { role } = useSession();
  const notice = updates?.notifications.find(n => n.kind === 'arrive' && n.mode === 'customer'
    && n.arrivalActive && n.readAt === null && updates.serverNow - n.createdAt < 300_000);
  const delivery = deliveryUpdates?.updates.find(update => update.readAt === null
    && (updates?.serverNow ?? Date.now()) - update.createdAt < 300_000);
  if (role !== 'customer' || !notice && !delivery) return null;
  return <SafeAreaView edges={['top','left','right']} style={{ padding: 12, gap: 6, backgroundColor: '#fff0bd' }}>
    <Text accessibilityLiveRegion="polite" style={styles.label}>{notice ? 'DRIVER HAS ARRIVED' : delivery!.title}</Text>
    <Text style={styles.body} numberOfLines={3}>{notice?.body ?? delivery!.body}</Text>
    <Button title={notice ? 'Review arrival details' : 'Review Kemmy delivery update'} secondary onPress={() => router.push('/updates')}/>
  </SafeAreaView>;
}
