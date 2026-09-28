import { Pressable, View } from 'react-native';
import { Text } from '../ui/typography';
import type { BookingState, BookingController } from './controller';
import type { Place } from '../../../../packages/shared/src/mobile-booking.mjs';
import { Button, Field, Loading, styles } from '../ui/components';

export function PlaceSearch({ endpoint, state, controller, disabled, actionTitle, onSearch, onSelect }: {
  endpoint: 'pickup' | 'destination'; state: BookingState; controller: BookingController; disabled: boolean;
  actionTitle?: string; onSearch?: () => void; onSelect?: (place: Place) => void;
}) {
  const value = state[endpoint], label = endpoint === 'pickup' ? 'Pickup address' : 'Destination';
  return <View style={styles.stack}>
    <Field label={label} placeholder={endpoint === 'pickup' ? 'Street or landmark, town and state' : 'Where are you going?'} value={value.query}
      onChangeText={(query) => controller.edit(endpoint, query)} editable={!disabled} maxLength={160} autoCorrect={false} returnKeyType="search"
      onSubmitEditing={() => onSearch ? onSearch() : void controller.search(endpoint)}/>
    <Button title={actionTitle ?? `Search ${endpoint}`} secondary={endpoint === 'pickup'} disabled={disabled || value.searching}
      onPress={() => onSearch ? onSearch() : void controller.search(endpoint)}/>
    {value.searching && <Loading/>}
    {value.selected && <Text style={styles.body} accessibilityLiveRegion="polite">✓ Selected: {value.selected.name}</Text>}
    {value.results.map((place, index) => <Pressable key={`${place.lat}:${place.lng}:${index}`} accessibilityRole="button" accessibilityLabel={`Select ${place.name}`}
      accessibilityState={{ disabled }} disabled={disabled} style={[styles.input, { paddingVertical: 16 }]}
      onPress={() => onSelect ? onSelect(place) : controller.select(endpoint, place)}><Text style={styles.body}>{place.name}</Text></Pressable>)}
    {value.searched && !value.results.length && !value.searching && <Text style={styles.small}>No matching Nigerian addresses. Include the town and state, or try a nearby landmark.</Text>}
    {!!value.attribution && <Text style={styles.small}>{value.attribution}</Text>}
  </View>;
}
