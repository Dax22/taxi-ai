import { useEffect } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { transportCategory, parcelLoadLimit } from '../../../packages/shared/src/transport-categories.mjs';
import type { DeliveryDraft } from '../src/booking/controller';
import { Alert, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from '../src/ui/typography';
import { useSession } from '../src/session/provider';
import { useBooking } from '../src/booking/use-booking';
import { PlaceSearch } from '../src/booking/place-search';
import { RoutePreview } from '../src/booking/route-preview';
import { RequestCard } from '../src/booking/request-card';
import { PassengerForm } from '../src/booking/passenger-form';
import { Button, Card, Field, Heading, Loading, Notice, Pill, Screen, styles } from '../src/ui/components';
import type { BookingRide } from '../../../packages/shared/src/mobile-booking.mjs';
import { VehicleCategories } from '../src/ui/vehicle-categories';
import { vehicleCategory } from '../../../packages/shared/src/vehicle-categories.mjs';
import type { VehicleCategoryId } from '../../../packages/shared/src/vehicle-categories.mjs';

function BookingScreen() {
  const { state: s, controller: c } = useBooking(), { width, fontScale } = useWindowDimensions();
  const { category: initialCategory, service } = useLocalSearchParams<{ category?: string; service?: string }>();
  useEffect(() => { c.chooseService(service === 'courier' ? 'courier' : 'ride'); if (vehicleCategory(initialCategory)) c.chooseCategory(initialCategory as VehicleCategoryId); }, [c, initialCategory, service]);
  const policy = transportCategory(s.category), delivery = s.service === 'courier' || policy?.service === 'delivery';
  const settings = s.settings, locked = !!s.busy || !!s.uncertain, disabled = locked || s.stale;
  const planningDisabled = disabled || s.locatingPickup;
  const wide = width >= 820 && fontScale <= 1.3;
  const showDeveloperSample = __DEV__ && process.env.EXPO_PUBLIC_SHOW_SAMPLE_BOOKING === '1';
  const samplePickup = settings?.areas.find((area) => area.id === s.pickupId);
  const cancel = (ride: BookingRide) => Alert.alert('Cancel this journey?', `${ride.pickup} → ${ride.destination}. You will need to create a new request if your plans change.`, [
    { text: 'Keep journey', style: 'cancel' }, { text: 'Cancel journey', style: 'destructive', onPress: () => void c.cancel(ride) },
  ]);
  const shown = settings?.current.length ? settings.current : s.lastRide ? [s.lastRide] : [];
  return <Screen><Pill>RIDES & DELIVERIES · NIGERIA</Pill><Heading title={delivery ? 'Send a parcel.' : 'Where to?'} subtitle={delivery ? 'Choose pickup and delivery addresses, a suitable vehicle and an agreed fare.' : 'Your route. Your choice. A fare you both agree.'}/>
    <Text style={styles.small}>Development preview · no live rides or payments.</Text><Notice message={s.error}/>
    {s.uncertain && <Card><Text style={styles.h2}>Let’s confirm that action.</Text><Text style={styles.body}>The connection ended before confirmation arrived. Retrying reuses the original action to avoid creating a duplicate request.</Text>
      <Button title={s.uncertain === 'request' ? 'Retry the same request' : 'Retry the same cancellation'} busy={!!s.busy} onPress={() => void c.retry()}/></Card>}
    {s.stale && settings && <Text accessibilityLiveRegion="polite" style={styles.body}>Refresh to check your latest account status before making changes.</Text>}
    <Button title={settings ? 'Refresh request status' : 'Load booking'} secondary busy={s.loading} disabled={!!s.busy} onPress={() => void c.refresh()}/>
    {!settings && s.loading && <Loading/>}
    {shown.map((ride) => <RequestCard key={ride.id} ride={ride} now={s.now} disabled={disabled} onCancel={() => cancel(ride)}/>)}
    {settings?.blockedBy && <Card><Text style={styles.h2}>{settings.blockedBy === 'online' ? 'You’re online as a driver.' : 'You have active driver work.'}</Text>
      <Text style={styles.body}>{settings.blockedBy === 'online' ? 'Go offline from your driver account on the website before requesting a ride.' : 'Finish or cancel your driver journey before requesting a ride.'}</Text></Card>}
    {settings && !settings.current.length && !settings.blockedBy && <VehicleCategories value={s.category} onChange={(id) => c.chooseCategory(id)} disabled={locked} courier={s.service === 'courier'}/>}
    {settings && !settings.current.length && !settings.blockedBy && <>
      {!delivery && <PassengerForm passenger={s.passenger} controller={c} disabled={disabled}/>}
      {!delivery && s.mode === 'route' && settings.online.enabled && <Card><Pill>YOUR DESTINATION</Pill><Text style={styles.h2}>Where are you going?</Text>
        <Text style={styles.body}>Type an address, landmark, town or city anywhere in Nigeria.</Text>
        {!s.consent ? <><Text style={styles.small}>Address search starts only when you choose to enable it.</Text><Button title="Enable address search" disabled={disabled} onPress={() => c.consent()}/></>
          : <PlaceSearch endpoint="destination" state={s} controller={c} disabled={planningDisabled} actionTitle={s.destination.searching ? 'Finding rides…' : 'Find rides'}
              onSearch={() => void c.findRides()} onSelect={(place) => void c.chooseRideDestination(place)}/>}
      </Card>}
      {delivery && <Card><Text style={styles.h2}>What are you sending?</Text>
        {([['description', 'Parcel description and size'], ['weightKg', 'Total weight (kg)'], ['recipientName', 'Recipient name'], ['pickupInstructions', 'Pickup instructions (optional)'], ['dropoffInstructions', 'Drop-off instructions (optional)']] as [keyof DeliveryDraft, string][]).map(([field, label]) => <Field key={field} label={label} value={s.delivery[field]} editable={!disabled} keyboardType={field === 'weightKg' ? 'decimal-pad' : 'default'} maxLength={field === 'weightKg' ? 10 : field === 'recipientName' ? 100 : 240} onChangeText={(value) => c.editDelivery(field, value)}/>)}
        <Text style={styles.small}>{s.category === 'standard' ? 'Car' : vehicleCategory(s.category)?.name} parcel limit: {parcelLoadLimit(s.category)} kg. Matching also checks the driver’s approved load capacity. Confirm the load fits before collection.</Text><Text style={styles.small}>After requesting, share a private tracking invitation from your journey. Your recipient signs in and accepts it to follow the delivery. They give the drop-off code to the driver only after receiving the parcel.</Text>
      </Card>}
      {!s.mode || s.mode === 'sample' && !showDeveloperSample ? <Card><Text style={styles.h2}>Nationwide route planning is unavailable.</Text><Text style={styles.body}>Taxi Ai needs the configured nationwide address and routing service before a ride can be requested here.</Text></Card> : <>
        <View style={styles.row}>{settings.online.enabled && <Button title="Search addresses" secondary={s.mode !== 'route'} disabled={locked} onPress={() => c.chooseMode('route')}/>}
          {showDeveloperSample && settings.allowSample && <Button title="Developer sample" secondary={s.mode !== 'sample'} disabled={locked} onPress={() => c.chooseMode('sample')}/>}</View>
        <View style={[look.columns, wide && look.wide]}><View style={[look.column, wide && look.wideColumn]}><Card><Text style={styles.h2}>{delivery ? 'Plan your delivery route' : 'Confirm your pickup and route'}</Text>
          {s.mode === 'route' ? <>
            {!s.consent ? delivery ? <><Text style={styles.body}>Search streets and landmarks across Nigeria. Include the town and state for more precise results. Search terms go to {settings.online.searchHost ?? 'the configured address provider'}; selected pickup and destination coordinates go to {settings.online.routeHost ?? 'the configured routing provider'} for a route preview.</Text>
              <Text style={styles.small}>Search happens when you tap Search. Current pickup requests a one-time phone location only when you choose it.</Text><Button title="Enable address search" disabled={disabled} onPress={() => c.consent()}/></> : <Text style={styles.body}>Enter your destination above, then confirm where you want to be picked up.</Text>
              : <><Button title="Use current location for pickup" busy={s.locatingPickup} disabled={planningDisabled}
                onPress={() => void (delivery ? c.useCurrentPickup() : c.useRidePickup())}/>
                <PlaceSearch endpoint="pickup" state={s} controller={c} disabled={disabled}
                  onSelect={delivery ? undefined : (place) => void c.chooseRidePickup(place)}/>
                {delivery && <PlaceSearch endpoint="destination" state={s} controller={c} disabled={planningDisabled}/>}</>}
          </> : <><Text style={styles.body}>Try the request flow with sample Abuja areas and fictional fares.</Text>
            <Text style={styles.small}>This local demo uses a fixed pickup area: {samplePickup?.name ?? 'the first available sample area'}.</Text>
            <Field label="Destination" placeholder="Type an Abuja area, e.g. Maitama" value={s.sampleDestinationQuery} editable={!disabled} maxLength={160}
              autoCorrect={false} onChangeText={(query) => c.editSampleDestination(query)}/>
            {!!s.sampleDestinationQuery.trim() && !s.destinationId && settings.areas.filter((area) => area.id !== s.pickupId && area.name.toLowerCase().includes(s.sampleDestinationQuery.trim().toLowerCase())).slice(0, 5).map((area) =>
              <Pressable key={area.id} accessibilityRole="button" accessibilityLabel={`Use ${area.name} as destination`} disabled={disabled}
                style={[styles.input, { paddingVertical: 16 }]} onPress={() => c.sample('destination', area.id)}><Text style={styles.body}>{area.name}</Text></Pressable>)}
            <Text style={styles.small}>{s.destinationId ? 'Destination matched to a sample area.' : `Sample areas: ${settings.areas.filter((area) => area.id !== s.pickupId).map((area) => area.name).join(', ')}.`}</Text></>}
          {(s.mode === 'sample' || s.consent) && <Button title={s.preview ? 'Preview route again' : 'Preview route & fare'} secondary={!!s.preview} busy={s.busy === 'preview'} disabled={planningDisabled} onPress={() => void c.preview()}/>}
        </Card></View>
        {s.preview && <View style={[look.column, wide && look.wideColumn]}><RoutePreview preview={s.preview} now={s.now} disabled={disabled} busy={s.busy === 'request'} passengerName={!delivery && s.passenger.kind === 'guest' ? s.passenger.name.trim() : undefined}
          onRequest={() => void c.submit()} onPreview={() => void c.preview()} onChooseCategory={!delivery ? (id) => { c.chooseCategory(id); void c.preview(); } : undefined}/></View>}
        </View>
      </>}
    </>}
    <Text style={styles.small}>Request status refreshes every 10 seconds while this screen is open. You can also refresh above.</Text>
  </Screen>;
}
export default function BookRide() { const { user, role } = useSession(); return role === 'driver' ? <Redirect href="/work"/> : user ? <BookingScreen key={user.id}/> : null; }
const look = StyleSheet.create({ columns: { gap: 20 }, wide: { flexDirection: 'row', alignItems: 'flex-start' }, column: { width: '100%', gap: 16 }, wideColumn: { flex: 1, width: undefined, minWidth: 0 } });
