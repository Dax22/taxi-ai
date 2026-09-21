import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { VEHICLE_CATEGORIES, vehicleCategory } from '../../../../packages/shared/src/vehicle-categories.mjs';
import type { VehicleCategoryId } from '../../../../packages/shared/src/vehicle-categories.mjs';
import { categoryImages } from './vehicle-category-images';
import { colors, styles } from './components';

export function VehicleCategories({ value, onChange, disabled = false }: {
  value: VehicleCategoryId; onChange(id: VehicleCategoryId): void; disabled?: boolean;
}) {
  const { width, fontScale } = useWindowDimensions();
  const columns = fontScale > 1.5 ? 1 : width >= 820 ? 5 : width >= 580 ? 3 : 2;
  const selected = vehicleCategory(value);
  return <View style={look.section}>
    <Text accessibilityRole="header" style={styles.h2}>Choose your vehicle</Text>
    <View style={look.grid} accessibilityRole="radiogroup" accessibilityLabel="Explore vehicle categories">
      {VEHICLE_CATEGORIES.map((category) => <Pressable key={category.id} disabled={disabled}
        accessibilityRole="radio" accessibilityLabel={`${category.name}, ${category.purpose}, ${category.statusLabel}`}
        accessibilityState={{ checked: category.id === value, disabled }}
        onPress={() => onChange(category.id)}
        style={({ pressed }) => [look.option, { width: `${100 / columns}%` }, disabled && look.disabled, pressed && look.pressed]}>
        <View style={[look.card, category.id === value && look.selected]}>
          <Image source={categoryImages[category.id]} accessible={false} style={look.image} resizeMode="contain"/>
          <Text style={look.name}>{category.name}</Text><Text style={styles.small}>{category.purpose}</Text>
          <View style={look.badge}><Text style={look.status}>{category.statusLabel}</Text></View>
        </View>
      </Pressable>)}
    </View>
    <Text accessibilityLiveRegion="polite" style={styles.small}>{selected ? `${selected.name} · ${selected.statusLabel}. ${selected.description}` : 'Choose a vehicle category.'}</Text>
  </View>;
}
const look = StyleSheet.create({
  section: { gap: 12 }, grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  option: { padding: 5 }, card: { flex: 1, minWidth: 0, padding: 12, gap: 6, backgroundColor: '#f8f9f5', borderRadius: 16, borderWidth: 2, borderColor: colors.border },
  selected: { backgroundColor: '#fff4cf', borderColor: '#9b7100' }, image: { width: '100%', height: 110 },
  name: { fontSize: 17, fontWeight: '700', color: colors.ink }, badge: { marginTop: 'auto', alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 20, backgroundColor: colors.white },
  status: { fontSize: 11, fontWeight: '700', color: colors.ink }, disabled: { opacity: .6 }, pressed: { opacity: .8 },
});
