import { useState } from 'react';
import { Alert, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSession } from '../src/session/provider';
import { useBooking } from '../src/booking/use-booking';
import { PlaceSearch } from '../src/booking/place-search';
import { RoutePreview } from '../src/booking/route-preview';
import { RequestCard } from '../src/booking/request-card';
import { SelectField } from '../src/ui/select-field';
import { Button, Card, Heading, Loading, Notice, Pill, Screen, openWebsite, styles } from '../src/ui/components';
import type { BookingRide } from '../../../packages/shared/src/mobile-booking.mjs';
import { VehicleCategories } from '../src/ui/vehicle-categories';
import { vehicleCategory } from '../../../packages/shared/src/vehicle-categories.mjs';
import type { VehicleCategoryId } from '../../../packages/shared/src/vehicle-categories.mjs';

function BookingScreen() {
  const { client } = useSession(), { state: s, controller: c } = useBooking(), { width, fontScale } = useWindowDimensions();
  const [linkError, setLinkError] = useState('');
  const [categoryId, setCategoryId] = useState<VehicleCategoryId>('standard');
  const settings = s.settings, locked = !!s.busy || !!s.uncertain, disabled = locked || s.stale;
  const wide = width >= 820 && fontScale <= 1.3;
  const open = () => { setLinkError(''); void openWebsite(client.origin).catch(() => setLinkError('Could not open the website. Please try again.')); };
  const cancel = (ride: BookingRide) => Alert.alert('Cancel this journey?', `${ride.pickup} → ${ride.destination}. You will need to create a new request if your plans change.`, [
    { text: 'Keep journey', style: 'cancel' }, { text: 'Cancel journey', style: 'destructive', onPress: () => void c.cancel(ride) },
  ]);
  const shown = settings?.current.length ? settings.current : s.lastRide ? [s.lastRide] : [];
  return <Screen><Pill>RIDES · ABUJA</Pill><Heading title="Where to?" subtitle="Your route. Your choice. A fare you both agree."/>
    <Text style={styles.small}>Development preview · no live rides or payments.</Text><Notice message={s.error || linkError}/>
    {s.uncertain && <Card><Text style={styles.h2}>Let’s confirm that action.</Text><Text style={styles.body}>The connection ended before confirmation arrived. Retrying reuses the original action to avoid creating a duplicate request.</Text>
      <Button title={s.uncertain === 'request' ? 'Retry the same request' : 'Retry the same cancellation'} busy={!!s.busy} onPress={() => void c.retry()}/></Card>}
    {s.stale && settings && <Text accessibilityLiveRegion="polite" style={styles.body}>Refresh to check your latest account status before making changes.</Text>}
    <Button title={settings ? 'Refresh request status' : 'Load booking'} secondary busy={s.loading} disabled={!!s.busy} onPress={() => void c.refresh()}/>
    {!settings && s.loading && <Loading/>}
    {shown.map((ride) => <RequestCard key={ride.id} ride={ride} now={s.now} disabled={disabled} onCancel={() => cancel(ride)} onWebsite={open}/>)}
    {settings?.blockedBy && <Card><Text style={styles.h2}>{settings.blockedBy === 'online' ? 'You’re online as a driver.' : 'You have active driver work.'}</Text>
      <Text style={styles.body}>{settings.blockedBy === 'online' ? 'Go offline on the website before requesting your own ride.' : 'Finish or cancel your driver journey before requesting your own ride.'}</Text><Button title="Open website" secondary onPress={open}/></Card>}
    {settings && !settings.current.length && !settings.blockedBy && <VehicleCategories value={categoryId} onChange={setCategoryId} disabled={locked}/>}
    {settings && !settings.current.length && !settings.blockedBy && vehicleCategory(categoryId)?.ridePreview && <>
      {!s.mode ? <Card><Text style={styles.h2}>Route planning is unavailable.</Text><Text style={styles.body}>Address search and sample routes are disabled in this environment. Please check again later.</Text></Card> : <>
        <View style={styles.row}>{settings.online.enabled && <Button title="Abuja address" secondary={s.mode !== 'route'} disabled={locked} onPress={() => c.chooseMode('route')}/>}
          {settings.allowSample && <Button title="Sample journey" secondary={s.mode !== 'sample'} disabled={locked} onPress={() => c.chooseMode('sample')}/>}</View>
        <View style={[look.columns, wide && look.wide]}><View style={[look.column, wide && look.wideColumn]}><Card><Text style={styles.h2}>Plan your journey</Text>
          {s.mode === 'route' ? <>
            {!s.consent ? <><Text style={styles.body}>Search Abuja streets and landmarks. Search terms go to {settings.online.searchHost ?? 'the configured address provider'}; selected pickup and destination coordinates go to {settings.online.routeHost ?? 'the configured routing provider'} for a route preview.</Text>
              <Text style={styles.small}>Search happens when you tap Search. This screen does not track your phone’s location.</Text><Button title="Enable address search" disabled={disabled} onPress={() => c.consent()}/></>
              : <><PlaceSearch endpoint="pickup" state={s} controller={c} disabled={disabled}/><PlaceSearch endpoint="destination" state={s} controller={c} disabled={disabled}/></>}
          </> : <><Text style={styles.body}>Try the request flow with sample Abuja areas and fictional fares.</Text>
            <SelectField label="Pickup area" value={s.pickupId} options={settings.areas.map((a) => ({ value: a.id, label: a.name, disabled: a.id === s.destinationId }))} disabled={disabled} onChange={(id) => c.sample('pickup', id)}/>
            <SelectField label="Destination area" value={s.destinationId} options={settings.areas.map((a) => ({ value: a.id, label: a.name, disabled: a.id === s.pickupId }))} disabled={disabled} onChange={(id) => c.sample('destination', id)}/></>}
          {(s.mode === 'sample' || s.consent) && <Button title={s.preview ? 'Preview route again' : 'Preview route & fare'} secondary={!!s.preview} busy={s.busy === 'preview'} disabled={disabled} onPress={() => void c.preview()}/>}
        </Card></View>
        {s.preview && <View style={[look.column, wide && look.wideColumn]}><RoutePreview preview={s.preview} now={s.now} disabled={disabled} busy={s.busy === 'request'} onRequest={() => void c.submit()} onPreview={() => void c.preview()}/></View>}
        </View>
      </>}
    </>}
    <Text style={styles.small}>Request status refreshes every 10 seconds while this screen is open. You can also refresh above.</Text>
  </Screen>;
}
export default function BookRide() { const { user } = useSession(); return user ? <BookingScreen key={user.id}/> : null; }
const look = StyleSheet.create({ columns: { gap: 20 }, wide: { flexDirection: 'row', alignItems: 'flex-start' }, column: { width: '100%', gap: 16 }, wideColumn: { flex: 1, width: undefined, minWidth: 0 } });
