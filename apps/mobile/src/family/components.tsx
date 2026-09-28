import { Alert, Pressable, View } from 'react-native';
import { Text } from '../ui/typography';
import { Button, Card, Pill, styles } from '../ui/components';
import { NativeMap } from '../maps/native-map';
import { familyLocationStatus } from './location';
import { familyCheckInState } from './check-in';
import type { FamilyResponse, FamilyTripResponse } from '../../../../packages/shared/src/family.mjs';
import type { FamilyController } from './controller';

type Summary = FamilyResponse['family']['trips'][number];
const statuses: Record<string, string> = {
  booked: 'Booking confirmed', on_way: 'Driver on the way', arrived: 'Driver at pickup',
  in_progress: 'Trip in progress', completed: 'Driver marked trip completed', cancelled: 'Trip cancelled', expired: 'Trip expired',
};
export function AdultConfirmation({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange(value: boolean): void }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel="I confirm I am 18 or older" accessibilityState={{ checked, disabled }}
    disabled={disabled} onPress={() => onChange(!checked)} style={[styles.row, { paddingVertical: 10 }]}>
    <View style={{ width: 24, height: 24, borderWidth: 2, borderColor: '#171a18', borderRadius: 5, backgroundColor: checked ? '#f4b400' : '#fff', justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: '#171a18', fontWeight: '700' }}>{checked ? '✓' : ''}</Text>
    </View><Text style={[styles.body, { flex: 1 }]}>I confirm I am 18 or older.</Text>
  </Pressable>;
}
export function FamilyTripSummary({ trip, selected, disabled, onOpen }: { trip: Summary; selected: boolean; disabled: boolean; onOpen(): void }) {
  const checkIn = familyCheckInState(trip.checkIn);
  return <Card><Pill>{trip.relationship === 'watching' ? 'SHARED WITH YOU' : 'YOUR SHARED TRIP'}</Pill>
    <Text style={styles.h2}>{trip.relationship === 'watching' ? trip.name : `Sharing with ${trip.name}`}</Text>
    <Text style={styles.body}>{statuses[trip.status] ?? trip.status.replaceAll('_', ' ')}</Text>
    <Text style={styles.small}>{trip.sharingActive ? 'Trip viewing is active.' : 'Live trip access has ended.'}</Text>
    {trip.safeArrivalAt ? <Text style={styles.body}>Passenger confirmed safe arrival · {new Date(trip.safeArrivalAt).toLocaleTimeString()}</Text>
      : trip.status === 'completed' ? <Text style={styles.body}>Passenger has not confirmed safe arrival.</Text> : null}
    {checkIn === 'pending' && <Text style={styles.body}>Check-in requested · waiting for a response.</Text>}
    {checkIn === 'help' && <Text accessibilityRole="alert" style={styles.errorText}>Passenger requested help.</Text>}
    <Button title={selected ? 'Viewing this trip' : 'View trip and check-ins'} secondary disabled={disabled || selected} onPress={onOpen}/>
  </Card>;
}
export function FamilyTripDetail({ trip, controller: c, now, disabled }: { trip: FamilyTripResponse['trip']; controller: FamilyController; now: number; disabled: boolean }) {
  const owner = trip.relationship === 'sharing_with';
  const checkIn = familyCheckInState(trip.checkIn);
  const location = trip.sharingActive ? trip.location : null;
  const position = familyLocationStatus(location, now, trip.sharingActive);
  function respond(response: 'okay' | 'help' | 'arrived') {
    const title = response === 'help' ? 'Request help from your contacts?' : response === 'arrived' ? 'Confirm you arrived safely?' : 'Confirm you are okay?';
    const detail = response === 'help' ? 'This saves a help request in the Family Safety inbox of every approved contact currently viewing this trip. It does not contact emergency services.'
      : 'This records your own confirmation and shares it with every approved contact currently viewing this trip.';
    Alert.alert(title, detail, [{ text: 'Back', style: 'cancel' }, { text: response === 'help' ? 'Request help' : 'Confirm', onPress: () => void c.command('respond', { shareId: trip.shareId, expectedVersion: trip.version, response }) }]);
  }
  return <Card><Text accessibilityRole="header" style={styles.h2}>{owner ? 'Your sharing controls' : `${trip.name}’s trip`}</Text>
    <Text style={styles.body}>{statuses[trip.status] ?? trip.status.replaceAll('_', ' ')}</Text>
    {trip.sharingActive && <>
      {trip.pickup && trip.destination && <Text style={styles.body}>{trip.pickup} → {trip.destination}</Text>}
      {trip.driver && <><Text style={styles.body}>Driver · {trip.driver.name}</Text><Text style={styles.body}>{trip.driver.vehicle.model}{trip.driver.vehicle.colour ? ` · ${trip.driver.vehicle.colour}` : ''} · {trip.driver.vehicle.plate}</Text></>}
      <Text style={styles.label}>VEHICLE LOCATION</Text><Pill>{position.label.toUpperCase()}</Pill>
      {location && <><Text style={styles.body}>Updated {position.ageSeconds} seconds ago · {new Date(location.capturedAt).toLocaleTimeString()}</Text>
        <Text style={styles.small}>Reported accuracy: {Math.round(location.accuracy)} metres.</Text>
        <NativeMap pins={[{ id: 'family-vehicle', lat: location.lat, lng: location.lng, title: position.label, stale: position.state === 'stale', description: `Reported accuracy ${Math.round(location.accuracy)} metres.` }]} summary="Vehicle location for the trip shared with you."/>
      </>}
      <Text style={styles.small}>Location comes from the driver’s phone. It does not track the passenger’s phone or confirm their safety. Missing updates may mean a weak connection or that the driver stopped sharing.</Text>
    </>}
    {!trip.sharingActive && <Text style={styles.body}>Live location and driver details are no longer available for this shared trip.</Text>}
    {trip.safeArrivalAt ? <Text style={styles.body}>Passenger confirmed safe arrival · {new Date(trip.safeArrivalAt).toLocaleString()}</Text>
      : trip.status === 'completed' ? <Text style={styles.body}>The driver completed the trip. Passenger safe arrival is not yet confirmed.</Text> : null}
    {trip.checkIn && <Text style={checkIn === 'help' ? styles.errorText : styles.body} accessibilityLiveRegion="polite">{
      checkIn === 'pending' ? 'A new check-in is waiting for the passenger’s response.' : checkIn === 'help' ? 'Passenger requested help.' : checkIn === 'okay' ? 'Passenger confirmed they are okay.' : checkIn === 'arrived' ? 'Passenger confirmed safe arrival.' : 'No passenger response is recorded.'
    }</Text>}
    {!owner && trip.sharingActive && <><Button title="Request a check-in" secondary disabled={disabled || !trip.canRequestCheckIn} onPress={() => void c.command('request-check-in', { shareId: trip.shareId, expectedVersion: trip.version })}/>
      {!trip.canRequestCheckIn && <Text style={styles.small}>A check-in is pending or the request cooldown has not ended.</Text>}</>}
    {owner && trip.sharingActive && <><Button title="I’m okay" disabled={disabled || !trip.canRespond} onPress={() => respond('okay')}/>
      <Button title="I need help" secondary disabled={disabled || !trip.canRequestHelp} onPress={() => respond('help')}/>
      {!trip.canRespond && <Text style={styles.small}>Please wait briefly before sending another response.</Text>}</>}
    {owner && trip.canConfirmArrival && <Button title="I’ve arrived safely" disabled={disabled} onPress={() => respond('arrived')}/>}
    {owner && (trip.sharingActive || trip.status === 'completed') && <Button title={trip.sharingActive ? 'Stop sharing this trip' : 'Stop sharing trip updates'} secondary disabled={disabled} onPress={() => Alert.alert('Stop sharing this trip?', `${trip.name} will lose access to this trip and any further Family Safety updates about it.`, [
      { text: 'Back', style: 'cancel' }, { text: 'Stop sharing', style: 'destructive', onPress: () => void c.command('stop-sharing', { shareId: trip.shareId, expectedVersion: trip.version }) },
    ])}/>}
    <Text style={styles.small}>A saved or sent alert does not confirm that a person has seen it. If you need urgent help, contact emergency services directly.</Text>
  </Card>;
}
