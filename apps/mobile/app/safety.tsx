import { Alert, Pressable, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafety } from '../src/safety/provider';
import { shareTripLink } from '../src/safety/share';
import { Button, Card, Field, Heading, Loading, Notice, Pill, Screen, styles } from '../src/ui/components';
import { SAFETY_PREVIEW_NOTICE, SAFETY_OPTIONS, SAFETY_SHARE_MINUTES, safetyId, safetyLocationLabel } from '../../../packages/shared/src/mobile-safety.mjs';
import type { SafetyCommand, SafetyIncident } from '../../../packages/shared/src/mobile-safety.mjs';
const incidentLabels = { open: 'Open test incident', acknowledged: 'Test administrator acknowledged the record', resolved: 'Test record closed — not a confirmation of safety' };
const alertLabels = { queued: 'Test alert queued — not sent', sent: 'Sending simulated', delivered: 'Delivery simulated — no real delivery', failed: 'Simulated delivery failed', cancelled: 'Test alert cancelled' };

function Incident({ incident, now }: { incident: SafetyIncident; now: number }) {
  return <Card><Text style={styles.h2}>{incidentLabels[incident.status]}</Text>
    <Text style={styles.body}>{SAFETY_OPTIONS.find((option) => option.id === incident.kind)?.label}</Text>
    <Text style={styles.small}>Recorded {new Date(incident.createdAt).toLocaleString()} · {incident.id}</Text>
    {Boolean(incident.note) && <Text style={styles.body}>{incident.note}</Text>}
    <Text style={styles.body}>Recorded driver · {incident.driverName} · {incident.vehiclePlate}</Text>
    <Text style={styles.small}>{safetyLocationLabel(incident.location, now)}</Text>
    {incident.notifications.length === 0 && <Text style={styles.small}>No trusted contacts selected for simulated alerts.</Text>}
    {incident.notifications.map((n) => <Text key={n.id} style={styles.body}>{n.recipientName} ({n.recipientPhone}) · {alertLabels[n.status]}</Text>)}
    {incident.events.filter((e) => e.action !== 'created').map((e, index) => <Text key={index} style={styles.small}>{new Date(e.createdAt).toLocaleString()} · {e.action === 'acknowledged' ? 'Test record acknowledged' : 'Test record closed'} · {e.note}</Text>)}
  </Card>;
}
function SafetyScreen({ rideId }: { rideId: string | null }) {
  const { controller: c, state: s } = useSafety(rideId), locked = s.busy || s.uncertain || s.stale;
  const confirm = (title: string, text: string, command: SafetyCommand | null) => {
    if (!command) return;
    Alert.alert(title, text, [{ text: 'Back', style: 'cancel' }, { text: title, onPress: () => void c.submit(command) }]);
  };
  return <Screen><Heading title="Safety & trusted contacts" subtitle={rideId ? 'Private controls for this journey.' : 'Your contacts are shared with your web account.'}/>
    <Card><Pill>TEST SAFETY WORKFLOW</Pill><Text style={styles.body}>{SAFETY_PREVIEW_NOTICE}</Text>
      <Text style={styles.small}>Saving a report does not call anyone, start GPS, record audio, change your fare or cancel the trip. Help outside this app remains your responsibility in this preview.</Text></Card>
    <Notice message={s.error}/>{Boolean(s.message) && <Text accessibilityLiveRegion="polite" style={styles.body}>{s.message}</Text>}
    {s.loading && <Loading/>}<Button title="Refresh safety details" secondary busy={s.loading} disabled={s.busy} onPress={() => void c.refresh()}/>
    {s.stale && <Text style={styles.body}>Reconnect and refresh to review current records. Offline guidance above remains available; this app cannot save an offline SOS.</Text>}
    {s.uncertain && <Card><Text style={styles.body}>A previous action has an unknown outcome. Retrying uses its original details, not the current form.</Text><Button title="Retry the same safety action" busy={s.busy} onPress={() => void c.retry()}/></Card>}
    {rideId && <>
      <Card><Text style={styles.h2}>Report a concern / test SOS</Text><Text style={styles.small}>{safetyLocationLabel(s.trip?.location ?? null, s.now)}</Text>
        {s.trip && !s.trip.canRaise && <Text style={styles.body}>New test reports and links are available only during a confirmed active journey. Saved reports remain below.</Text>}
        {s.trip?.canRaise && <>
          <Text style={styles.small}>These options are manual reports, not automatic crash or distress detection.</Text>
          {SAFETY_OPTIONS.map((option) => <Pressable key={option.id} accessibilityRole="radio" accessibilityLabel={option.label} accessibilityState={{ checked: s.kind === option.id, disabled: locked }} disabled={locked} onPress={() => c.chooseKind(option.id)} style={[styles.button, styles.secondary]}><Text style={styles.buttonText}>{s.kind === option.id ? '● ' : '○ '}{option.label}</Text></Pressable>)}
          <Field label="Optional private note (up to 500 characters)" value={s.note} maxLength={500} multiline editable={!locked} onChangeText={(v) => c.edit('note', v)}/>
          <Text style={styles.body}>Choose contacts for simulated alerts (optional)</Text>
          {s.contacts.map((contact) => <Pressable key={contact.id} accessibilityRole="checkbox" accessibilityLabel={`${contact.name}, ${contact.phone}`} accessibilityState={{ checked: Object.hasOwn(s.selected, contact.id), disabled: locked }} disabled={locked} onPress={() => c.toggle(contact)} style={[styles.button, styles.secondary]}><Text style={styles.buttonText}>{Object.hasOwn(s.selected, contact.id) ? '☑ ' : '☐ '}{contact.name} · {contact.phone}</Text></Pressable>)}
          <Button title="Review and save test SOS" disabled={locked || s.trip.incidents.some((i) => i.status !== 'resolved')} onPress={() => confirm('Save test SOS', 'Save a private test incident for administrator review? Selected contact alerts are simulated. Nobody is contacted and help is not dispatched.', c.reportCommand())}/>
          {s.trip.incidents.some((i) => i.status !== 'resolved') && <Text style={styles.small}>An unresolved test incident already exists for you on this journey. Review its saved record below.</Text>}
        </>}
      </Card>
      <Card><Text style={styles.h2}>Private trip sharing</Text><Text style={styles.body}>A link exposes the driver name, vehicle plate, route and any available driver-shared location to anyone holding it. It does not expose your contacts, report, chat, fare, parcel details or PINs.</Text>
        <Text style={styles.small}>No native live tracking is started. Localhost links are not reachable on other phones. Hosted preview recipients need their own invited access. Never share sign-in credentials.</Text>
        {s.trip?.share && <Text style={styles.body}>{s.now >= s.trip.share.expiresAt ? 'Link expired' : 'Active link'} · expires {new Date(s.trip.share.expiresAt).toLocaleTimeString()}</Text>}
        {s.trip?.canRaise && <>{SAFETY_SHARE_MINUTES.map((minutes) => <Button key={minutes} title={`${s.minutes === minutes ? 'Selected · ' : ''}${minutes} minutes`} secondary disabled={locked} onPress={() => c.chooseMinutes(minutes)}/>)}
          <Button title={s.trip.share ? 'Review and replace private link' : 'Review and create private link'} disabled={locked} onPress={() => confirm('Create private link', 'Create a link for the selected duration? Any existing link for you on this trip will end. Sharing the new link is a separate action.', c.linkCommand())}/></>}
        {s.hasLink && <Button title="Share private link…" disabled={locked} onPress={() => void c.shareLink(shareTripLink)}/>}
        {s.trip?.share && !s.hasLink && <Text style={styles.small}>Link secrets are not stored on the phone. To share again after leaving, backgrounding or using the share dialog, explicitly replace the link. Existing recipients keep access until revocation or expiry.</Text>}
        {s.trip?.share && <Button title="Revoke private link" secondary disabled={locked} onPress={() => confirm('Revoke link', 'End access through this link? Copies already made by a recipient cannot be recalled.', { action: 'link.revoke', id: s.trip!.share!.id, data: { expectedVersion: s.trip!.share!.version } })}/>}
      </Card>
      {s.trip?.incidents.map((incident) => <Incident key={incident.id} incident={incident} now={s.now}/>)}
    </>}
    <Card><Text style={styles.h2}>Trusted contacts · {s.contacts.length}/3</Text><Text style={styles.small}>Use fictional numbers in this preview. Saving a number does not verify ownership or notify that person.</Text>
      {s.contacts.map((contact) => <Card key={contact.id}><Text style={styles.body}>{contact.name} · {contact.phone}</Text>
        <Button title={`Edit ${contact.name}`} secondary disabled={locked} onPress={() => c.editContact(contact)}/>
        <Button title={`Remove ${contact.name}`} secondary disabled={locked} onPress={() => confirm('Remove contact', 'Remove this contact and cancel their pending simulated alerts? Previous incident evidence is retained.', { action: 'contact.remove', id: contact.id, data: { expectedVersion: contact.version } })}/>
      </Card>)}
      {(s.contacts.length < 3 || s.editing) && <><Field label="Contact name" value={s.name} maxLength={80} editable={!locked} onChangeText={(v) => c.edit('name', v)}/>
        <Field label="International phone number, including + and country code" value={s.phone} keyboardType="phone-pad" maxLength={16} editable={!locked} onChangeText={(v) => c.edit('phone', v)}/>
        <Button title={s.editing ? 'Save contact changes' : 'Add trusted contact'} disabled={locked || s.name.trim().length < 2 || !/^\+[1-9]\d{7,14}$/.test(s.phone.trim())} onPress={() => void c.submit(c.contactCommand())}/></>}
      {s.editing && <Button title="Cancel contact editing" secondary disabled={locked} onPress={() => c.editContact(null)}/>}
    </Card><Text style={styles.small}>No automated emergency response, police integration or real safety messages are enabled.</Text>
  </Screen>;
}
export default function Safety() {
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  return rideId !== undefined && !safetyId(rideId)
    ? <Screen><Heading title="Safety"/><Text style={styles.body}>{SAFETY_PREVIEW_NOTICE}</Text><Notice message="Open safety from a journey or your Account screen."/></Screen>
    : <SafetyScreen key={rideId ?? 'contacts'} rideId={rideId ?? null}/>;
}
