import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import type { BookingPreview } from '../../../../packages/shared/src/mobile-booking.mjs';
import { Button, Card, colors, fare, Pill, styles } from '../ui/components';
import { routeDrawing } from './route-drawing';

export function RoutePreview({ preview, now, disabled, busy, onRequest, onPreview }: {
  preview: BookingPreview; now: number; disabled: boolean; busy: boolean; onRequest(): void; onPreview(): void;
}) {
  const expired = preview.expiresAt !== null && now >= preview.expiresAt;
  const drawing = preview.route ? routeDrawing(preview.route.coordinates) : null;
  return <Card><Pill>REVIEW YOUR JOURNEY</Pill>
    {drawing && <View style={look.map} accessible accessibilityLabel={`Route preview from ${preview.pickup} to ${preview.destination}. This is not live tracking.`}>
      <Svg width="100%" height="100%" viewBox="0 0 360 220" preserveAspectRatio="xMidYMid meet" accessible={false}>
        <Rect width={360} height={220} fill="#f0f2e9"/>
        {[40,100,160,220,280,340].map((x) => <Line key={`x${x}`} x1={x} y1={0} x2={x} y2={220} stroke="#fff" strokeWidth={12}/>)}
        {[45,110,175].map((y) => <Line key={`y${y}`} x1={0} y1={y} x2={360} y2={y} stroke="#fff" strokeWidth={12}/>)}
        <Polyline points={drawing.line} fill="none" stroke={colors.ink} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round"/>
        <Polyline points={drawing.line} fill="none" stroke={colors.yellow} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>
        {[drawing.start,drawing.end].map((p,i) => <Circle key={i} cx={p.x} cy={p.y} r={15} fill={i ? colors.ink : colors.yellow} stroke="#fff" strokeWidth={3}/>)}
        {[drawing.start,drawing.end].map((p,i) => <SvgText key={i} x={p.x} y={p.y + 5} textAnchor="middle" fontSize={13} fontWeight="bold" fill={i ? '#fff' : colors.ink}>{i ? 'B' : 'A'}</SvgText>)}
      </Svg>
    </View>}
    <View style={styles.stack}><Text style={styles.body}>A · {preview.pickup}</Text><Text style={styles.body}>B · {preview.destination}</Text></View>
    {preview.route ? <><View style={styles.row}><Text style={styles.body}>{(preview.route.distanceMeters / 1000).toFixed(1)} km</Text><Text style={styles.body}>About {Math.ceil(preview.route.durationSeconds / 60)} min driving</Text></View>
      <Text style={styles.small}>Route outline on a decorative grid · not a street map. © OpenStreetMap contributors · OSRM. Travel time excludes traffic and driver arrival.</Text></>
      : <Text style={styles.small}>Sample areas for local testing. No road route or travel time is calculated.</Text>}
    <View style={look.fare}><Text style={styles.label}>SUGGESTED FARE</Text><Text style={styles.title}>{fare(preview.suggestedFareKobo)}</Text><Text style={styles.body}>You and the driver agree the final fare.</Text></View>
    <Text style={styles.small}>Illustrative pricing for this development preview. Requesting a driver does not accept a fare or confirm a booking. No live dispatch or payment.</Text>
    {preview.expiresAt !== null && <Text style={styles.small}>{expired ? 'This preview has expired.' : `Route preview valid for about ${Math.max(1, Math.ceil((preview.expiresAt - now) / 60_000))} more min.`}</Text>}
    {expired ? <Button title="Refresh route preview" onPress={onPreview} disabled={disabled}/> : <Button title="Request a driver · preview" onPress={onRequest} busy={busy} disabled={disabled}/>}
  </Card>;
}
const look = StyleSheet.create({ map: { width: '100%', aspectRatio: 360 / 220, borderRadius: 18, overflow: 'hidden' },
  fare: { padding: 18, borderRadius: 18, backgroundColor: '#fff3ce', gap: 8 } });
