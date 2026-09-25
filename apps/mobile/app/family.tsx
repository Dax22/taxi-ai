import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from '../src/ui/typography';
import { Button, Card, Field, Heading, Loading, Notice, Pill, Screen, styles } from '../src/ui/components';
import { useFamily } from '../src/family/use-family';
import { familyDeliveryLabel } from '../src/family/delivery';
import { AdultConfirmation, FamilyTripDetail, FamilyTripSummary } from '../src/family/components';
import type { FamilyResponse } from '../../../packages/shared/src/family.mjs';

type Contact = FamilyResponse['family']['contacts'][number];
export default function Family() {
  const { rideId: requestedRideId } = useLocalSearchParams<{ rideId?: string }>();
  const { controller: c, state: s } = useFamily(), data = s.family;
  const [email, setEmail] = useState(''), [adult, setAdult] = useState(false);
  const [rideId, setRideId] = useState(typeof requestedRideId === 'string' ? requestedRideId : '');
  const [contactId, setContactId] = useState('');
  const locked = s.busy || s.stale || s.uncertain;
  const eligible = data?.contacts.filter(contact => contact.status === 'active' && contact.canShare) ?? [];
  const selectedRide = data?.availableTrips.find(trip => trip.rideId === rideId);
  const selectedContact = eligible.find(contact => contact.id === contactId);
  useEffect(() => { if (!data) { setEmail(''); setAdult(false); setContactId(''); } }, [data === null]);
  function remove(contact: Contact) {
    Alert.alert('Remove this family connection?', 'All trip access through this connection will end. A new invitation and acceptance will be needed to reconnect.', [
      { text: 'Back', style: 'cancel' }, { text: 'Remove connection', style: 'destructive', onPress: () => void c.command('revoke-contact', { contactId: contact.id, expectedVersion: contact.version }) },
    ]);
  }
  return <Screen><Heading title="Family Safety." subtitle="Stay connected, one shared trip at a time."/>
    <Text style={styles.body}>Invite an adult you trust, then choose each trip you want them to see. Accepted connections do not share trips automatically.</Text>
    <Notice message={s.error}/>{s.notice && <Text accessibilityLiveRegion="polite" style={styles.body}>{s.notice}</Text>}
    <Button title="Refresh Family Safety" secondary busy={s.loading} disabled={s.busy} onPress={() => void c.refresh()}/>
    {s.uncertain && <Card><Text style={styles.body}>The connection was interrupted. The last action may have been saved.</Text><Button title="Retry the same action" busy={s.busy} onPress={() => void c.retry()}/></Card>}
    {!data && s.loading && <Loading/>}
    {data && <>
      <Card><Text style={styles.h2}>Invite someone you trust</Text><Text style={styles.body}>Invite a registered adult to view trips you choose to share. They must accept from their own Taxi Ai account.</Text>
        <Field label="Their Taxi Ai email address" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" maxLength={254} editable={!locked}/>
        <AdultConfirmation checked={adult} disabled={locked} onChange={setAdult}/>
        <Button title="Send invitation" disabled={locked || !adult || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())} onPress={() => void c.command('invite', { email: email.trim(), adultConfirmed: true }).then(saved => { if (saved) { setEmail(''); setAdult(false); } })}/>
        <Text style={styles.small}>Adult confirmation is self-declared. This release does not create child or guardian accounts.</Text>
      </Card>
      <Text accessibilityRole="header" style={styles.h2}>Your connections</Text>
      {!data.contacts.length && <Text style={styles.body}>You have no family connections yet.</Text>}
      {data.contacts.map(contact => <Card key={contact.id}><Pill>{contact.status.toUpperCase()}</Pill><Text style={styles.h2}>{contact.name}</Text>
        <Text style={styles.body}>{contact.direction === 'sharing_with' ? 'You can choose trips for this person to view.' : 'This person can choose trips for you to view.'}</Text>
        {contact.status === 'pending' && <Text style={styles.small}>Invitation expires {new Date(contact.expiresAt).toLocaleString()}.</Text>}
        {contact.status === 'pending' && contact.direction === 'watching' && <><Text style={styles.body}>Accepting lets you view only the trips they explicitly share. It does not share your own trips.</Text>
          <AdultConfirmation checked={adult} disabled={locked} onChange={setAdult}/><Button title="Accept invitation" disabled={locked || !adult} onPress={() => void c.command('accept', { contactId: contact.id, expectedVersion: contact.version, adultConfirmed: true })}/>
          <Button title="Decline invitation" secondary disabled={locked} onPress={() => void c.command('decline', { contactId: contact.id, expectedVersion: contact.version })}/></>}
        {(contact.status === 'active' || contact.status === 'pending' && contact.direction === 'sharing_with') && <Button title={contact.status === 'pending' ? 'Cancel invitation' : 'Remove connection'} secondary disabled={locked} onPress={() => remove(contact)}/>}
      </Card>)}
      <Card><Text accessibilityRole="header" style={styles.h2}>Share one of your trips</Text>
        <Text style={styles.body}>Choose a confirmed ride you are taking yourself, then choose an accepted contact. Live access ends when the trip finishes or you stop sharing.</Text>
        {!data.availableTrips.length && <Text style={styles.small}>Your confirmed passenger trips will appear here. Guest bookings and deliveries are not eligible.</Text>}
        {data.availableTrips.map(trip => <Button key={trip.rideId} title={`${trip.rideId === rideId ? 'Selected · ' : ''}${trip.pickup} → ${trip.destination}`} secondary disabled={locked} onPress={() => setRideId(trip.rideId)}/>)}
        {!eligible.length && <Text style={styles.small}>An adult must accept your invitation before you can share a trip.</Text>}
        {eligible.map(contact => <Button key={contact.id} title={`${contact.id === contactId ? 'Selected · ' : ''}${contact.name}`} secondary disabled={locked} onPress={() => setContactId(contact.id)}/>)}
        <Button title="Share this trip with this contact" disabled={locked || !selectedRide || !selectedContact} onPress={() => Alert.alert('Share this trip?', `${selectedContact?.name} will see your trip’s pickup, destination, driver and available vehicle location. They cannot book, pay, cancel or negotiate fares for you.`, [
          { text: 'Back', style: 'cancel' }, { text: 'Share trip', onPress: () => void c.command('share', { rideId, contactId }) },
        ])}/>
      </Card>
      <Text accessibilityRole="header" style={styles.h2}>Shared journeys</Text>
      {!data.trips.length && <Text style={styles.body}>Trips you share and trips shared with you will appear here.</Text>}
      {data.trips.map(trip => <View key={trip.shareId} style={styles.stack}>
        <FamilyTripSummary trip={trip} selected={trip.shareId === s.selectedId} disabled={s.busy} onOpen={() => c.selectTrip(trip.shareId)}/>
        {s.trip?.shareId === trip.shareId && <FamilyTripDetail trip={s.trip} controller={c} now={s.now} disabled={locked}/>}
      </View>)}
      <Text accessibilityRole="header" style={styles.h2}>Family inbox</Text>
      <Text style={styles.small}>Saved means the update is in this account’s inbox. Acknowledged means the recipient explicitly confirmed seeing it.</Text>
      {!data.inbox.length && <Text style={styles.body}>Invitations, journey updates and check-ins will appear here.</Text>}
      {data.inbox.map(event => <Card key={event.id}><Pill>{event.state === 'acknowledged' ? 'ACKNOWLEDGED BY YOU' : 'SAVED IN YOUR INBOX'}</Pill>
        <Text style={styles.h2}>{event.title}</Text><Text style={styles.small}>{new Date(event.createdAt).toLocaleString()}</Text><Text style={styles.small}>{familyDeliveryLabel(event.delivery)}</Text>
        {event.shareId && data.trips.some(trip => trip.shareId === event.shareId) && <Button title="Review shared trip" secondary disabled={s.busy} onPress={() => c.selectTrip(event.shareId)}/>}
        {event.state !== 'acknowledged' && <Button title="Acknowledge this update" secondary disabled={locked} onPress={() => void c.command('acknowledge', { eventId: event.id })}/>}
      </Card>)}
      <Button title="Manage phone alerts in Updates" secondary onPress={() => router.push('/updates')}/>
    </>}
  </Screen>;
}
