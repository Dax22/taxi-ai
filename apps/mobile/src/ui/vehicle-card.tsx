import { StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import type { VehicleIdentity } from '../../../../packages/shared/src/vehicle-profile.mjs';
import { vehiclePresentation } from '../../../../packages/shared/src/vehicle-profile.mjs';
import { vehicleArtwork } from '../../../../packages/shared/src/vehicle-artwork.mjs';
import { colors, styles } from './components';

export function VehicleCard({ vehicle, label = 'YOUR VEHICLE', compact = false }: { vehicle: Partial<VehicleIdentity>; label?: string; compact?: boolean }) {
  const value = vehiclePresentation(vehicle);
  return <View style={card.container}>
    <View style={card.art} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <SvgXml xml={vehicleArtwork(vehicle.colour)} width="100%" height={compact ? 146 : 190}/>
    </View>
    <View style={card.info}><Text style={styles.label}>{label}</Text><Text style={styles.h2}>{value.title}</Text>
      <Text style={styles.body}>{value.description}</Text>
      <View style={card.plate}><View style={card.plateStripe}/><Text selectable accessibilityLabel={`Number plate ${value.plate}`} style={card.plateText}>{value.plate}</Text></View>
      <Text style={styles.small}>{value.illustrationNote}</Text>
    </View>
  </View>;
}
const card = StyleSheet.create({
  container: { borderWidth: 1, borderColor: colors.border, borderRadius: 22, overflow: 'hidden', backgroundColor: colors.white },
  art: { backgroundColor: '#F1F3EF', width: '100%' }, info: { padding: 20, gap: 9 },
  plate: { alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', borderWidth: 1, borderColor: '#9BA69E', borderRadius: 8, backgroundColor: '#FCFDFB', overflow: 'hidden', marginVertical: 3 },
  plateStripe: { width: 7, backgroundColor: '#467260' }, plateText: { flexShrink: 1, fontSize: 22, letterSpacing: 1.5, fontWeight: '800', color: colors.ink, paddingVertical: 10, paddingHorizontal: 14 },
});
