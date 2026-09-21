import { Component, useCallback, useEffect, useRef, useState } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useFocusEffect } from 'expo-router';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useSession } from '../session/provider';
import { Button, colors, styles } from '../ui/components';
import { coordinate, mapRegion, nativeMapPolicy } from './model';
import type { MapPin, MapPoint } from './model';

class MapBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Text style={styles.body}>The map could not open. Your journey details are still available.</Text> : this.props.children; }
}
/** Display only: never starts phone GPS or makes booking/routing decisions. */
export function NativeMap({ pins, route = [], direct = false, summary, fallback }: { pins: MapPin[]; route?: MapPoint[]; direct?: boolean; summary: string; fallback?: ReactNode }) {
  const { blocked } = useSession();
  const [shown, setShown] = useState(false), [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const map = useRef<MapView>(null);
  const policy = nativeMapPolicy(Platform.OS, Constants.expoConfig?.extra?.nativeMaps?.androidConfigured === true,
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient);
  useFocusEffect(useCallback(() => { setFocused(true); return () => { setFocused(false); setShown(false); }; }, []));
  useEffect(() => {
    const listener = AppState.addEventListener('change', next => { setForeground(next === 'active'); if (next !== 'active') setShown(false); });
    return () => listener.remove();
  }, []);
  let region;
  try { region = mapRegion([...pins, ...route]); } catch { region = null; }
  if (!region) return <>{fallback}<Text style={styles.small}>No map position is available.</Text></>;
  if (!policy.available) return <>{fallback}<Text style={styles.small}>The street map is unavailable. You can still use the journey details.</Text></>;
  const visible = shown && focused && foreground && !blocked;
  return <View style={styles.stack}>
    <Text style={styles.small}>{policy.label} displays the area you choose to view. Opening the map sends that area to the map provider and does not start location sharing.</Text>
    {!visible ? <>{fallback}<Button title={`Show ${policy.label}`} secondary disabled={blocked || !foreground || !focused} onPress={() => setShown(true)}/></>
      : <><MapBoundary><View style={look.map}>
        <MapView ref={map} style={StyleSheet.absoluteFill} provider={policy.provider} initialRegion={region}
          accessibilityLabel={summary} mapType="standard" showsUserLocation={false} showsMyLocationButton={false}
          toolbarEnabled={false} showsTraffic={false} showsPointsOfInterests={false} rotateEnabled={false} pitchEnabled={false}>
          {route.length > 1 && <Polyline coordinates={route.map(coordinate)} strokeColor={colors.ink} strokeWidth={4} {...(direct ? { lineDashPattern: [8, 6] } : {})}/>}
          {pins.map(pin => <Marker key={pin.id} identifier={pin.id} coordinate={coordinate(pin)} title={pin.title}
            description={pin.description} pinColor={pin.stale ? '#777777' : pin.id === 'pickup' ? colors.yellow : colors.ink}/>) }
        </MapView>
      </View></MapBoundary>
      <Button title={route.length ? 'Fit route on map' : 'Show latest position on map'} secondary onPress={() => map.current?.animateToRegion(region, 250)}/>
      <Button title="Hide map" secondary onPress={() => setShown(false)}/></>}
  </View>;
}
const look = StyleSheet.create({ map: { width: '100%', height: 280, borderRadius: 16, overflow: 'hidden' } });
