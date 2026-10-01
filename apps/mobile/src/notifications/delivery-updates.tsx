import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { DeliveryUpdate, DeliveryUpdateKind } from '../../../../packages/shared/src/delivery-updates.mjs';
import { useSession } from '../session/provider';
import { useOperations } from '../journeys/provider';
import { Button, Card, Notice, Pill, styles } from '../ui/components';
import { Text } from '../ui/typography';
import { DeliveryUpdatesController } from './delivery-controller';

function useDeliveryUpdates(kind?: DeliveryUpdateKind, targetId?: string) {
  const { client, user, blocked, mode } = useSession();
  const controller = useMemo(() => new DeliveryUpdatesController(client, kind && targetId ? { kind, targetId } : null), [client, user?.id, mode, kind, targetId]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useFocusEffect(useCallback(() => {
    if (blocked || !user) return;
    if (AppState.currentState === 'active') controller.activate();
    const appState = AppState.addEventListener('change', next => next === 'active' ? controller.activate() : controller.pause());
    const changed = client.subscribeChanges(() => controller.refresh());
    const poll = setInterval(() => void controller.refresh(), 10_000);
    return () => { appState.remove(); changed(); clearInterval(poll); controller.pause(); };
  }, [controller, client, user?.id, blocked]));
  return { controller, state, blocked };
}
function DeliveryNotice({ update }: { update: DeliveryUpdate }) {
  return <><Pill>{`KEMMY · ${update.kind === 'food' ? 'FOOD' : 'PARCEL'}${update.readAt === null ? ' · NEW' : ''}`}</Pill>
    <Text accessibilityLiveRegion="polite" style={styles.h2}>{update.title}</Text>
    <Text style={styles.body}>{update.body}</Text>{!!update.note && <Text style={styles.small}>{update.note}</Text>}
    <Text style={styles.small}>Update recorded {new Date(update.createdAt).toLocaleString()}{update.phase === 'picked_up' && update.etaMinutes !== null ? ' · Estimate measured at pickup, not a live countdown.' : ''}</Text></>;
}
export function KemmyDeliveryCard({ kind, targetId }: { kind: DeliveryUpdateKind; targetId: string }) {
  const { state, controller, blocked } = useDeliveryUpdates(kind, targetId);
  if (blocked || !state.update && !state.error) return null;
  return <Card>{state.update && <DeliveryNotice update={state.update}/>}<Notice message={state.error}/>
    {!!state.error && <Button title="Refresh delivery update" secondary busy={state.loading} onPress={() => void controller.refresh()}/>}</Card>;
}
export function DeliveryInbox() {
  const { state, controller, blocked } = useDeliveryUpdates(), ops = useOperations();
  const { mode } = useSession();
  async function open(id: string) {
    const target = await controller.open(id);
    if (!target) return;
    ops.dismissDeliveryPush(); void ops.refreshUpdates();
    if (mode !== 'customer') { router.push('/updates'); return; }
    if (target.screen === 'food-order') router.push({ pathname: '/food-order', params: { id: target.id } });
    else if (target.screen === 'journey') router.push({ pathname: '/journey', params: { id: target.id } });
    else router.push({ pathname: '/parcels', params: { rideId: target.id } });
  }
  if (blocked) return null;
  return <><Notice message={state.error}/>
    <Button title="Refresh delivery updates" secondary busy={state.loading} disabled={state.busy} onPress={() => void controller.refresh()}/>
    {ops.deliveryPushId && <Card><Text style={styles.body}>Kemmy has a delivery update. Confirm that it is still available for your account.</Text>
      <Button title="Review delivery alert" busy={state.busy} disabled={mode !== 'customer'} onPress={() => void open(ops.deliveryPushId!)}/>
      {mode !== 'customer' && <Text style={styles.body}>Switch to Customer in Account to review your delivery.</Text>}
      <Button title="Dismiss delivery alert" secondary onPress={ops.dismissDeliveryPush}/></Card>}
    {state.updates.map(update => <Card key={update.id}><DeliveryNotice update={update}/>
      <Button title={update.kind === 'food' ? 'View food delivery' : 'View parcel delivery'} disabled={state.busy || mode !== 'customer'} onPress={() => void open(update.id)}/>
      {mode !== 'customer' && <Text style={styles.small}>Switch to Customer in Account to view this delivery.</Text>}
    </Card>)}
    {!!state.nextBefore && <Button title="Older delivery updates" secondary busy={state.loading} disabled={state.busy} onPress={() => void controller.refresh(true)}/>}
  </>;
}
