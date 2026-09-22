import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { EatsController } from '../../../../packages/shared/src/eats-controller.mjs';
import { EATS_CUISINES, EATS_SYMBOLS } from '../../../../packages/shared/src/eats.mjs';
import { Text } from '../ui/typography';
import hero from '../assets/eats-hero.png';
import { colors, styles } from '../ui/components';

export function FoodHero() {
  return <View style={discovery.hero}><Image source={hero} style={discovery.heroPhoto} accessible={false}/><View style={discovery.heroCopy}><Text style={styles.label}>NIGERIAN FLAVOURS. YOUR WAY.</Text><Text accessibilityRole="header" style={discovery.title}>Your craving.{ '\n' }Your combination.</Text><Text style={styles.small}>Restaurants, food vendors & home kitchens.</Text><Text style={styles.small}>Nigerian food inspiration · AI artwork</Text></View></View>;
}
export function DiscoveryChip({ label, selected = false, expanded, disabled = false, onPress }: { label: string; selected?: boolean; expanded?: boolean; disabled?: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, expanded, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [discovery.control, selected && discovery.selected, { opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}><Text style={discovery.controlText}>{label}</Text></Pressable>;
}
export function FoodPhoto({ id, controller, label, compact = false }: { id?: string | null; controller: EatsController; label: string; compact?: boolean }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => { let current = true; setUri(null); if (id) void controller.photo(id).then((value) => { if (current) setUri(value); }); return () => { current = false; }; }, [id, controller]);
  return uri ? <Image source={{ uri }} style={compact ? discovery.mealPhoto : discovery.photo} resizeMode="cover" accessibilityLabel={label}/> : <View style={compact ? discovery.mealPhoto : discovery.photo}><Text style={styles.small}>Meal photo</Text></View>;
}
export function CuisineChips({ value, onChange }: { value: string; onChange(value: string): void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={discovery.chips}>{['', ...EATS_CUISINES].map((cuisine) => <Pressable key={cuisine} accessibilityRole="button" accessibilityState={{ selected: cuisine === value }} accessibilityLabel={cuisine || 'All food'} onPress={() => onChange(cuisine)} style={[discovery.chip, cuisine === value && discovery.selected]}><Text accessible={false} style={discovery.symbol}>{EATS_SYMBOLS[cuisine] ?? '🍽️'}</Text><Text style={styles.small}>{cuisine || 'All food'}</Text></Pressable>)}</ScrollView>;
}
export const discovery = StyleSheet.create({
  hero: { backgroundColor: '#ffde72', borderRadius: 26, overflow: 'hidden' },
  heroPhoto: { width: '100%', height: 190, resizeMode: 'cover' }, heroCopy: { padding: 22, gap: 10 },
  title: { fontSize: 28, lineHeight: 32, letterSpacing: -0.8, color: colors.ink, fontWeight: '700' },
  controls: { gap: 8, paddingVertical: 2 }, control: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, justifyContent: 'center' },
  controlText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  photo: { width: '100%', height: 190, backgroundColor: '#edf0e7', borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  mealPhoto: { width: '100%', height: 160, backgroundColor: '#edf0e7', borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: 10, paddingVertical: 4 }, chip: { padding: 14, minWidth: 84, minHeight: 90, alignItems: 'center', gap: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  selected: { backgroundColor: '#fff0bd', borderColor: colors.ink }, symbol: { fontSize: 28 },
  seller: { backgroundColor: '#e6ecdf', padding: 24, gap: 14, borderRadius: 24 },
});
