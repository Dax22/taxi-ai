import { Component, useCallback, useEffect, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useFocusEffect } from 'expo-router';
import MapView, { Marker } from 'react-native-maps';
import { nativeMapPolicy, coordinate, mapRegion } from '../maps/model';
import { Button, styles } from '../ui/components';
import { Text } from '../ui/typography';
import type { DeliveryPoint } from './delivery-position-request';

class DeliveryMapBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Text style={styles.small}>The map could not open. Enter the delivery address manually.</Text> : this.props.children; }
}

/** A map selection is explicit and never enables phone-location collection. */
export function DeliveryMap({ point, disabled, onSelect }: { point: DeliveryPoint | null; disabled: boolean; onSelect(point: DeliveryPoint): void }) {
  const [shown, setShown] = useState(false), [focused, setFocused] = useState(false), [foreground, setForeground] = useState(AppState.currentState === 'active');
  const map = useRef<MapView>(null);
  const policy = nativeMapPolicy(Platform.OS, Constants.expoConfig?.extra?.nativeMaps?.androidConfigured === true, Constants.executionEnvironment === ExecutionEnvironment.StoreClient);
  const region = point ? mapRegion([point])! : { latitude: 9.082, longitude: 8.6753, latitudeDelta: 12, longitudeDelta: 12 };
  useFocusEffect(useCallback(() => { setFocused(true); return () => { setFocused(false); setShown(false); }; }, []));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (value) => { setForeground(value === 'active'); if (value !== 'active') setShown(false); });
    return () => subscription.remove();
  }, []);
  useEffect(() => { if (shown && point) map.current?.animateToRegion(region, 250); }, [point?.lat, point?.lng, shown]);
  if (!policy.available) return <Text style={styles.small}>A delivery map is unavailable on this device. You can enter the address manually.</Text>;
  const visible = shown && focused && foreground;
  return <View style={styles.stack}>
    <Text style={styles.small}>{policy.label} sends the area you choose to the map provider. Opening the map does not use your phone’s current location.</Text>
    {!visible ? <Button title={`Choose a pin on ${policy.label}`} secondary disabled={disabled || !focused || !foreground} onPress={() => setShown(true)}/>
      : <><Text style={styles.small}>Tap the recipient’s delivery point or drag the pin. Review the suggested address before using it.</Text>
        <DeliveryMapBoundary><View style={look.map}>
          <MapView ref={map} style={StyleSheet.absoluteFill} provider={policy.provider} initialRegion={region} accessibilityLabel="Choose the food delivery point"
            showsUserLocation={false} showsMyLocationButton={false} toolbarEnabled={false} showsTraffic={false} showsPointsOfInterests={false} rotateEnabled={false} pitchEnabled={false}
            onPress={(event) => { if (!disabled) onSelect({ lat: event.nativeEvent.coordinate.latitude, lng: event.nativeEvent.coordinate.longitude }); }}>
            {point && <Marker coordinate={coordinate(point)} draggable={!disabled} title="Food delivery point"
              onDragEnd={(event) => { if (!disabled) onSelect({ lat: event.nativeEvent.coordinate.latitude, lng: event.nativeEvent.coordinate.longitude }); }}/>} 
          </MapView>
        </View></DeliveryMapBoundary>
        <Button title="Hide delivery map" secondary onPress={() => setShown(false)}/></>}
  </View>;
}
const look = StyleSheet.create({ map: { width: '100%', height: 280, borderRadius: 16, overflow: 'hidden' } });
