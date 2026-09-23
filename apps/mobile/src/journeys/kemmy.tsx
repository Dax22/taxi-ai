import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { kemmyUpdate } from '../../../../packages/shared/src/kemmy.mjs';
import type { Journey } from '../../../../packages/shared/src/mobile-journeys.mjs';
import { useTripLocation } from '../tracking/provider';
import { Text } from '../ui/typography';
import { Button, colors, styles } from '../ui/components';
import kemmyAvatar from '../assets/kemmy-avatar.png';

export function KemmyCard({ ride, now, ratingChoice, busy, onChoose, onRate }: {
  ride: Journey; now: number; ratingChoice: number; busy: boolean; onChoose(stars: number): void; onRate(): void;
}) {
  const { state } = useTripLocation(ride.id);
  const position = state.data?.share?.active ? state.data.share.position : null;
  const stale = state.stale || state.data?.share?.stale || !position || now - position.capturedAt >= 30_000;
  const update = kemmyUpdate(ride, { position, now, stale });
  const [visible, setVisible] = useState(true);
  useEffect(() => { setVisible(true); }, [ride.id, ride.status]);
  if (!update) return null;
  if (!visible) return <Button title="Show Kemmy’s update" secondary onPress={() => setVisible(true)}/>;
  return <View style={look.card} accessibilityLiveRegion="polite">
    <View style={look.top}><Image source={kemmyAvatar} style={look.avatar} accessibilityLabel="Kemmy assistant avatar"/>
      <View style={look.identity}><Text style={styles.label}>KEMMY · AI RIDE ASSISTANT</Text><Text style={styles.small}>Your journey update</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss Kemmy update" onPress={() => setVisible(false)} style={look.close}><Text style={styles.body}>×</Text></Pressable></View>
    <Text style={styles.body}>{update.message}</Text>
    {!!update.note && <Text style={styles.small}>{update.note}</Text>}
    {update.phase === 'rate' && !ride.rating && <><View style={look.stars}>{[1,2,3,4,5].map((stars) =>
      <Pressable key={stars} accessibilityRole="button" accessibilityLabel={`Rate ${stars} out of 5 stars`} accessibilityState={{ selected: ratingChoice === stars }}
        onPress={() => onChoose(stars)} disabled={busy} style={look.star}><Text style={look.starText}>{stars <= ratingChoice ? '★' : '☆'}</Text></Pressable>)}</View>
      <Button title="Send driver rating" disabled={!ratingChoice || busy} busy={busy} onPress={onRate}/></>}
  </View>;
}
const look = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#efc84d', borderRadius: 22, padding: 18, gap: 12, backgroundColor: '#fff9e7', shadowColor: '#202225', shadowOpacity: .14, shadowRadius: 14, elevation: 5 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 }, avatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#f3e8cd' },
  identity: { flex: 1 }, close: { padding: 8 }, stars: { flexDirection: 'row', gap: 4 }, star: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  starText: { fontSize: 30, color: colors.ink },
});
