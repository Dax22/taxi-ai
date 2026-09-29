import { vehicleCategory } from '../../../../packages/shared/src/vehicle-categories.mjs';
import type { VehicleCategoryId } from '../../../../packages/shared/src/vehicle-categories.mjs';
import { categoryFare, transportCategory } from '../../../../packages/shared/src/transport-categories.mjs';
import { StyleSheet, View } from 'react-native';
import { Text, fontFamilyBold } from '../ui/typography';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import type { BookingPreview } from '../../../../packages/shared/src/mobile-booking.mjs';
import { Button, Card, colors, fare, Pill, styles } from '../ui/components';
import { routeDrawing } from './route-drawing';
import { NativeMap } from '../maps/native-map';

export function RoutePreview({ preview, now, disabled, busy, onRequest, onPreview, onChooseCategory, passengerName }: {
  preview: BookingPreview; now: number; disabled: boolean; busy: boolean; onRequest(): void; onPreview(): void;
  onChooseCategory?: (id: VehicleCategoryId) => void; passengerName?: string;
}) {
  const expired = preview.expiresAt !== null && now >= preview.expiresAt;
  const drawing = preview.route ? routeDrawing(preview.route.coordinates) : null;
  const points = preview.route?.coordinates.map(([lng, lat]) => ({ lat, lng })) ?? [];
  const selectedCategory = preview.vehicleCategory ?? 'standard';
  const pricing = preview.route?.pricing;
  const baseFare = pricing ? Math.max(pricing.minimumKobo,
    Math.ceil((pricing.baseKobo + pricing.distanceKobo + pricing.timeKobo) / pricing.incrementKobo) * pricing.incrementKobo) : null;
  const rideOptions = transportCategory(selectedCategory)?.service === 'ride' ? (['standard','suv'] as VehicleCategoryId[]) : [selectedCategory];
  const isRide = transportCategory(selectedCategory)?.service === 'ride';
  return <Card><Pill>{onChooseCategory ? 'RIDE OPTIONS' : isRide ? 'RIDE REVIEW' : 'ROUTE PREVIEW'}</Pill>
    <View style={look.fare} accessibilityLiveRegion="polite"><Text style={styles.label}>SUGGESTED FARE</Text><Text style={styles.title}>{fare(preview.suggestedFareKobo)}</Text><Text style={styles.body}>You and the driver agree the final fare.</Text></View>
    {onChooseCategory && <View style={look.options}>{rideOptions.map((id) => {
      const category = vehicleCategory(id), selected = id === selectedCategory;
      const amount = selected ? preview.suggestedFareKobo : baseFare ? categoryFare(baseFare,id) : null;
      return <Button key={id} title={`${category?.name ?? id} · ${amount ? fare(amount) : '—'}`} secondary={!selected}
        disabled={disabled || busy || selected} onPress={() => onChooseCategory(id)}/>;
    })}</View>}
    <Pill>{`${vehicleCategory(selectedCategory)?.name.toUpperCase()} · REVIEW YOUR JOURNEY`}</Pill>
    {drawing && <NativeMap route={points} direct={preview.route?.distanceKind === 'straight_line'} summary={`Planned route from ${preview.pickup} to ${preview.destination}. This is not live tracking.`}
      pins={[{ ...points[0], id: 'pickup', title: 'A · Pickup route point', description: preview.pickup }, { ...points[points.length - 1], id: 'destination', title: 'B · Destination route point', description: preview.destination }]}
      fallback={<><View style={look.map} accessible accessibilityLabel={`Route outline from ${preview.pickup} to ${preview.destination}. This is not a street map or live tracking.`}>
      <Svg width="100%" height="100%" viewBox="0 0 360 220" preserveAspectRatio="xMidYMid meet" accessible={false}>
        <Rect width={360} height={220} fill="#f0f2e9"/>
        {[40,100,160,220,280,340].map((x) => <Line key={`x${x}`} x1={x} y1={0} x2={x} y2={220} stroke="#fff" strokeWidth={12}/>)}
        {[45,110,175].map((y) => <Line key={`y${y}`} x1={0} y1={y} x2={360} y2={y} stroke="#fff" strokeWidth={12}/>)}
        <Polyline points={drawing.line} fill="none" stroke={colors.ink} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round"/>
        <Polyline points={drawing.line} fill="none" stroke={colors.yellow} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>
        {[drawing.start,drawing.end].map((p,i) => <Circle key={i} cx={p.x} cy={p.y} r={15} fill={i ? colors.ink : colors.yellow} stroke="#fff" strokeWidth={3}/>)}
        {[drawing.start,drawing.end].map((p,i) => <SvgText key={i} x={p.x} y={p.y + 5} textAnchor="middle" fontFamily={fontFamilyBold} fontSize={13} fill={i ? '#fff' : colors.ink}>{i ? 'B' : 'A'}</SvgText>)}
      </Svg>
    </View><Text style={styles.small}>Route outline on a decorative grid · not a street map.</Text></>}/>}
    <View style={styles.stack}><Text style={styles.body}>A · {preview.pickup}</Text><Text style={styles.body}>B · {preview.destination}</Text></View>
    {passengerName && <Text style={styles.body}>Passenger · {passengerName} · Booked by you</Text>}
    {preview.route?.distanceKind === 'straight_line' ? <><Text style={styles.body}>{(preview.route.distanceMeters / 1000).toFixed(1)} km in a straight line</Text><Text style={styles.small}>Direct-distance delivery estimate, not a road route or driving ETA. Confirm access and timing with the driver.</Text></> : preview.route ? <><View style={styles.row}><Text style={styles.body}>{(preview.route.distanceMeters / 1000).toFixed(1)} km</Text><Text style={styles.body}>About {Math.ceil((preview.route.durationSeconds ?? 0) / 60)} min driving</Text></View>
      <Text style={styles.small}>Route data: © OpenStreetMap contributors · OSRM. Travel time excludes traffic and driver arrival.</Text></>
      : <Text style={styles.small}>Sample areas for local testing. No road route or travel time is calculated.</Text>}
    <Text style={styles.small}>This is a starting fare, not an accepted price. After a driver joins, agree the final amount in Taxi Ai chat before confirming the ride. No live dispatch or payment.</Text>
    {preview.expiresAt !== null && <Text style={styles.small}>{expired ? 'This preview has expired.' : `Route preview valid for about ${Math.max(1, Math.ceil((preview.expiresAt - now) / 60_000))} more min.`}</Text>}
    {expired ? <Button title={isRide ? 'Refresh ride options' : 'Refresh route preview'} onPress={onPreview} disabled={disabled}/>
      : <Button title={isRide ? `Find a ${vehicleCategory(selectedCategory)?.name ?? 'selected'} driver` : 'Find a delivery driver'} onPress={onRequest} busy={busy} disabled={disabled}/>}
  </Card>;
}
const look = StyleSheet.create({ options: { gap: 8 }, map: { width: '100%', aspectRatio: 360 / 220, borderRadius: 18, overflow: 'hidden' },
  fare: { padding: 18, borderRadius: 18, backgroundColor: '#fff3ce', gap: 8 } });
