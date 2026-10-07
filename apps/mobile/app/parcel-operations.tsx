import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { Alert, AppState } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useSession } from '../src/session/provider';
import { Text } from '../src/ui/typography';
import { Button, Card, Field, Heading, Notice, Screen, styles } from '../src/ui/components';
import { createDeliveryOperationsController } from '../../../packages/shared/src/delivery-operations-controller.mjs';
import { DELIVERY_OPERATION_STATES } from '../../../packages/shared/src/delivery-operations.mjs';
const reports = { recipient_unavailable: 'Recipient unavailable', incorrect_pin: 'Handover code needs review', damaged_parcel: 'Damaged parcel', failed_delivery: 'Delivery attempt failed' };
export default function ParcelOperations() {
  const { client, user, blocked } = useSession(), params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' && /^[a-f0-9-]{36}$/.test(params.id) ? params.id : null;
  const [note, setNote] = useState(''), [confirmation, setConfirmation] = useState(''), [reason, setReason] = useState('recipient_unavailable');
  const controller = useMemo(() => createDeliveryOperationsController({
    read: value => client.parcels(`/parcels/${value}/operations`),
    write: (value, data, key) => client.parcels(`/parcels/${value}/operations`, data, key),
    verify: async owner => client.account()?.id === owner, makeKey: randomUUID,
  }), [client, user?.id]);
  const s = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useFocusEffect(useCallback(() => {
    if (blocked || !user || !id) { controller.close(); return; }
    const refresh = () => { if (AppState.currentState === 'active') { controller.context(user.id, id); controller.tick(); void controller.refresh(); } };
    const changed = AppState.addEventListener('change', state => { if (state !== 'active') { controller.close(); setNote(''); setConfirmation(''); } else refresh(); });
    refresh(); const timer = setInterval(refresh, 10_000);
    return () => { clearInterval(timer); changed.remove(); controller.close(); setNote(''); setConfirmation(''); };
  }, [controller, blocked, user?.id, id]));
  const data = blocked ? null : s.data, locked = blocked || s.busy || s.loading || s.uncertain;
  function act(action: string) {
    const extra: Record<string, unknown> = { note: note.trim() };
    if (action === 'report') extra.reason = reason;
    if (action === 'confirm_return') extra.confirmation = confirmation.trim();
    const submit = () => void controller.command(action, extra).then(() => { if (!controller.snapshot().error) { setNote(''); setConfirmation(''); } });
    if (['authorize_return', 'confirm_return', 'resolve'].includes(action)) Alert.alert('Confirm delivery instruction', action === 'confirm_return' ? 'Confirm only after physically receiving the returned parcel.' : 'Record this instruction or resolution?', [{ text: 'Back', style: 'cancel' }, { text: 'Confirm', onPress: submit }]);
    else submit();
  }
  return <Screen><Heading title="Delivery record" subtitle="Handover evidence, delivery issues and returns."/><Notice message={s.error}/>
    {!id && <Notice message="Open this record from a parcel journey."/>}
    <Button title="Refresh delivery record" secondary busy={s.loading} disabled={s.busy || blocked || !id} onPress={() => void controller.refresh()}/>
    {s.uncertain && <Button title="Retry the same pending action" secondary busy={s.busy} disabled={blocked} onPress={() => void controller.retry()}/>}
    {data && <Card><Heading title={DELIVERY_OPERATION_STATES[data.state]}/>
      <Text style={styles.body}>{data.evidence ? `Recipient code verified ${new Date(data.evidence.verifiedAt).toLocaleString()}. ${data.evidence.locationRecorded ? 'A courier position was recorded.' : 'Fresh GPS was unavailable; no position was invented.'}` : 'No successful-delivery handover has been recorded.'}</Text>
      {data.events.map(event => <Text key={event.id} style={styles.body}>{new Date(event.createdAt).toLocaleString()} — {event.label}{event.note ? `: ${event.note}` : ''}</Text>)}
    </Card>}
    {data && Object.values(data.can).some(Boolean) && <Card>
      <Field label="Instruction or resolution" value={note} onChangeText={setNote} maxLength={500} editable={!locked}/>
      <Text style={styles.small}>Do not include handover codes or unnecessary personal information. Authorizing a return and resolving an issue require a note.</Text>
      {data.can.report && <>{Object.entries(reports).map(([value, title]) => <Button key={value} title={`${reason === value ? 'Selected: ' : ''}${title}`} secondary disabled={locked} onPress={() => setReason(value)}/>)}<Button title="Report selected issue" disabled={locked} onPress={() => act('report')}/></>}
      {data.can.requestReturn && <Button title="Request return" secondary disabled={locked} onPress={() => act('request_return')}/>}
      {data.can.authorizeReturn && <Button title="Authorize return to sender" disabled={locked} onPress={() => act('authorize_return')}/>}
      {data.can.resolve && <Button title="Record resolution" secondary disabled={locked} onPress={() => act('resolve')}/>}
      {data.can.confirmReturn && <><Field label="After receiving the returned parcel, type RECEIVED" value={confirmation} onChangeText={setConfirmation} autoCapitalize="characters" editable={!locked}/><Button title="Confirm returned parcel received" disabled={locked} onPress={() => act('confirm_return')}/></>}
    </Card>}
    <Text style={styles.small}>A pending confirmation is not a completed delivery. Returning a parcel does not mark it delivered; payment reconciliation is separate.</Text>
  </Screen>;
}
