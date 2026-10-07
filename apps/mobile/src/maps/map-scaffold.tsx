import type { PropsWithChildren, ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '../ui/typography';
import { colors } from '../ui/components';
import { coordinate, mapRegion, nativeMapPolicy } from './model';
import type { MapPin, MapPoint } from './model';

const ABUJA: MapPoint = { lat: 9.0765, lng: 7.3986 };

export function MapScaffold({ children, pins = [], route = [], center = ABUJA, direct = false, top, floating, mapLabel = 'Taxi Ai map' }:
  PropsWithChildren<{ pins?: MapPin[]; route?: MapPoint[]; center?: MapPoint; direct?: boolean; top?: ReactNode; floating?: ReactNode; mapLabel?: string }>) {
  const map = useRef<MapView>(null), policy = nativeMapPolicy(Platform.OS,
    Constants.expoConfig?.extra?.nativeMaps?.androidConfigured === true,
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient);
  const region = useMemo(() => mapRegion([...route, ...pins].length ? [...route, ...pins] : [center])!,
    [center.lat, center.lng, pins, route]);
  useEffect(() => { map.current?.animateToRegion(region, 350); }, [region.latitude, region.longitude, region.latitudeDelta, region.longitudeDelta]);
  return <SafeAreaView style={look.screen} edges={['top','left','right']}>
    <View style={look.mapSurface}>
      {policy.available ? <MapView ref={map} style={StyleSheet.absoluteFill} provider={policy.provider} initialRegion={region}
        accessibilityLabel={mapLabel} mapType="standard" toolbarEnabled={false} showsTraffic={false} showsPointsOfInterests
        showsUserLocation={false} showsMyLocationButton={false} rotateEnabled={false} pitchEnabled={false}>
        {route.length > 1 && <Polyline coordinates={route.map(coordinate)} strokeColor={colors.ink} strokeWidth={5}
          {...(direct ? { lineDashPattern: [8, 6] } : {})}/>} 
        {pins.map(pin => <Marker key={pin.id} identifier={pin.id} coordinate={coordinate(pin)} title={pin.title}
          description={pin.description} pinColor={pin.stale ? '#777777' : pin.id === 'me' || pin.id === 'pickup' ? colors.yellow : colors.ink}/>)}
      </MapView> : <View style={look.fallback}><View style={look.gridA}/><View style={look.gridB}/><Text style={look.fallbackTitle}>Taxi Ai</Text><Text style={look.fallbackText}>Street map unavailable on this build.</Text></View>}
      {top && <View style={look.top}>{top}</View>}
      {floating && <View style={look.floating}>{floating}</View>}
    </View>
    <View style={look.sheet}><View style={look.handle}/><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false} contentContainerStyle={look.sheetContent}>{children}</ScrollView></View>
  </SafeAreaView>;
}
const look=StyleSheet.create({
  screen:{flex:1,backgroundColor:colors.paper},mapSurface:{flex:1,minHeight:260,backgroundColor:'#e9eee8'},
  top:{position:'absolute',left:16,right:16,top:12},floating:{position:'absolute',right:16,bottom:18},
  sheet:{maxHeight:'58%',minHeight:210,backgroundColor:colors.paper,borderTopLeftRadius:28,borderTopRightRadius:28,
    marginTop:-24,shadowColor:'#000',shadowOpacity:.13,shadowRadius:18,shadowOffset:{width:0,height:-6},elevation:16},
  handle:{width:42,height:5,borderRadius:99,backgroundColor:'#c8cec6',alignSelf:'center',marginTop:10},sheetContent:{padding:20,paddingTop:14,paddingBottom:30,gap:14},
  fallback:{position:'absolute',left:0,right:0,top:0,bottom:0,overflow:'hidden',justifyContent:'center',alignItems:'center',backgroundColor:'#e8eee8'},
  gridA:{position:'absolute',left:-50,right:-50,top:'34%',height:26,backgroundColor:'#fff',transform:[{rotate:'-18deg'}]},
  gridB:{position:'absolute',left:'45%',top:-30,bottom:-30,width:22,backgroundColor:'#fff',transform:[{rotate:'10deg'}]},
  fallbackTitle:{fontSize:28,fontWeight:'800',color:colors.ink},fallbackText:{marginTop:6,fontSize:12,color:colors.muted},
});
