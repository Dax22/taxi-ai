import { foodLocationLabel } from '../src/eats/location-fields';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '../src/ui/typography';
import { useLocalSearchParams, router } from 'expo-router';
import { EATS_STATUS } from '../../../packages/shared/src/eats.mjs';
import type { FoodAction, FoodOrder as FoodOrderData } from '../../../packages/shared/src/eats.mjs';
import { useEatsScreen } from '../src/eats/provider';
import { FoodFeedback, FoodMoney, FoodPreview, FoodRecipientDetails, food } from '../src/eats/components';
import { showFoodOrderTracking } from '../src/eats/order-tracking';
import { workLocationBlocks, workLocationRequired } from '../src/journeys/work-location';
import { useTripLocation } from '../src/tracking/provider';
import { TripLocationCard } from '../src/tracking/view';
import type { TripLocationState } from '../src/tracking/controller';
import { CheckoutPaymentCard } from '../src/payments/checkout-card';
import { NativeMap } from '../src/maps/native-map';
import { Button, Card, Field, Heading, Pill, Screen, fare, styles } from '../src/ui/components';
const labels: Record<FoodAction, string> = { accept: 'Accept order', reject: 'Decline order', prepare: 'Start preparing', ready: 'Ready for pickup', claim: 'Accept delivery', pickup: 'Confirm food collected', arrive: 'I’m at the delivery address', deliver: 'Confirm delivered', complete_pickup: 'Confirm customer collected', cancel: 'Cancel order' };
type OrderStepProps = {
  order: FoodOrderData; locked: boolean; pin: string; reason: string; collectionPoint: string;
  setPin: (value: string) => void; setReason: (value: string) => void; setCollectionPoint: (value: string) => void;
  action: (value: FoodAction) => Promise<boolean>;
};
function OrderStep({ order: o, locked, pin, reason, collectionPoint, setPin, setReason, setCollectionPoint, action, tracking }: OrderStepProps & { tracking?: TripLocationState }) {
  if (!o.actions.length) return null;
  return <Card><Text style={styles.h2}>Next step</Text>
    {o.role === 'courier' && tracking && workLocationRequired(tracking) && o.actions.some(a => ['pickup', 'arrive'].includes(a)) &&
      <Text style={styles.body}>Live courier location sharing is required before collecting food or confirming arrival. Start sharing above and keep your location up to date.</Text>}
    {o.actions.some((a) => ['pickup','deliver','complete_pickup'].includes(a)) && <><Field label="Six-digit handover code" value={pin} onChangeText={setPin} maxLength={6} keyboardType="number-pad" editable={!locked}/><Text style={styles.small}>Get the code from the person handing over or receiving the food, in person.</Text></>}
    {o.actions.some((a) => ['cancel','reject'].includes(a)) && <Field label="Reason (for cancellation or decline)" value={reason} onChangeText={setReason} maxLength={240} editable={!locked}/>}
    {o.needsCollectionPoint && <><Field label="Private collection point and landmark" value={collectionPoint} onChangeText={setCollectionPoint} maxLength={240} editable={!locked}/><Text style={styles.small}>Shared only with the assigned courier or pickup customer for this order.</Text></>}
    {o.actions.map((a) => <Button key={a} title={labels[a]} secondary={['cancel','reject'].includes(a)} disabled={locked || Boolean(o.role === 'courier' && tracking && workLocationBlocks('food', a, tracking)) || (a === 'ready' && o.needsCollectionPoint && collectionPoint.trim().length < 8) || (['pickup','deliver','complete_pickup'].includes(a) && !/^\d{6}$/.test(pin)) || (['cancel','reject'].includes(a) && reason.trim().length < 5)} onPress={() => void action(a)}/>)}
  </Card>;
}
function FoodDeliveryProgress(props: OrderStepProps) {
  const { state, controller } = useTripLocation(props.order.id, 'food');
  async function action(value: FoodAction) {
    const completed = await props.action(value);
    if (completed && props.order.role === 'courier' && ['deliver', 'cancel'].includes(value)) {
      const local = controller.snapshot();
      if (local.sharing || local.background || local.busy) void controller.stop();
    }
    return completed;
  }
  return <><TripLocationCard id={props.order.id} kind="food" destination={props.order.address.point ?? undefined}/><OrderStep {...props} action={action} tracking={state}/></>;
}
export default function FoodOrder() {
  const { id } = useLocalSearchParams<{ id: string }>(), { state: s, controller: c, locked } = useEatsScreen('order', id ?? null);
  const [pin, setPin] = useState(''), [reason, setReason] = useState(''), [collectionPoint, setCollectionPoint] = useState(''); const o = s.order;
  useEffect(() => { setPin(''); setReason(''); setCollectionPoint(''); }, [id]);
  async function action(value: FoodAction) {
    if (!o) return false;
    const extra = ['pickup','deliver','complete_pickup'].includes(value) ? { pin } : ['cancel','reject'].includes(value) ? { reason } : value === 'ready' && o.needsCollectionPoint ? { collectionPoint } : {};
    const completed = await c.orderAction(o, value, extra);
    if (completed) { setPin(''); setReason(''); setCollectionPoint(''); }
    return completed;
  }
  const step = o ? { order: o, locked, pin, reason, collectionPoint, setPin, setReason, setCollectionPoint, action } : null;
  return <Screen><FoodPreview/><FoodFeedback state={s} controller={c}/>
    {o && <><Pill>{`FOOD ORDER · ${o.id.slice(0,8).toUpperCase()}`}</Pill><Heading title={EATS_STATUS[o.status]} subtitle={o.restaurant.name}/>
      <Card><Text style={styles.h2}>Order details</Text><Text style={styles.body}>{o.fulfillment === 'pickup' ? 'Customer pickup · collect from the kitchen' : 'Delivery'}</Text><Text style={styles.body}>Customer · {o.customerName}</Text><Text style={styles.body}>{o.restaurant.addressHidden ? `Kitchen area · ${foodLocationLabel(o.restaurant.areaId)}. A private collection point is shared when food is ready.` : `Collect from · ${o.restaurant.address}`}</Text>{o.address.line && <Text style={styles.body}>Deliver to · {o.address.line} · {foodLocationLabel(o.address.areaId)}</Text>}{!!o.instructions && <Text style={styles.body}>Instructions · {o.instructions}</Text>}
        <FoodRecipientDetails recipient={o.recipient}/>
        {o.address.point && !showFoodOrderTracking(o) && <NativeMap pins={[{ ...o.address.point, id: 'delivery', title: 'Food delivery point' }]} summary="Food delivery point selected by the customer"/>}
        {o.courier && <><Text style={styles.h2}>Your courier · {o.courier.name}</Text><Text style={styles.body}>{o.courier.vehicle.colour} {o.courier.vehicle.model} · {o.courier.vehicle.plate}</Text></>}
        {(o.pickupPin || o.deliveryPin) && <><Text style={styles.body}>{o.pickupPin ? 'Kitchen pickup code. Share only when handing the food to the assigned courier.' : o.recipient?.kind === 'other' ? 'Handover code for your recipient. Share it privately with them.' : o.fulfillment === 'pickup' ? 'Your pickup code. Show the kitchen when collecting your food.' : 'Your delivery code. Share only when you receive the food.'}</Text><Text selectable style={food.pin}>{o.pickupPin ?? o.deliveryPin}</Text></>}
        {o.deliveryPin && o.recipient?.kind === 'other' && <Text style={styles.small}>Share this code privately with {o.recipient.name}. Ask them to give it {o.fulfillment === 'pickup' ? 'to the kitchen only when collecting the food' : 'to the courier only when receiving the food'}. No automatic message is sent.</Text>}
      </Card>
      {o.role === 'customer' && o.payment.method === 'paystack' && <>
        {o.payment.status === 'pending' && o.payment.expiresAt && <Text style={styles.body}>Food is reserved until {new Date(o.payment.expiresAt).toLocaleString()}. Complete test checkout before preparation can begin.</Text>}
        {o.payment.status === 'expired' && <Text style={styles.body}>This food reservation has expired. Check any payment already attempted before placing another order.</Text>}
        {o.payment.targetId ? <CheckoutPaymentCard key={o.payment.targetId} kind="food" targetId={o.payment.targetId} grouped={o.payment.targetId !== o.id}/> : <Text style={styles.body}>Payment details are unavailable. Refresh this order before paying.</Text>}
      </>}
      {step && (showFoodOrderTracking(o) ? <FoodDeliveryProgress key={o.id} {...step}/> : <OrderStep {...step}/>)}
      <Card><Text style={styles.h2}>Your food</Text>{o.lines.map((i) => <Text key={i.itemId} style={styles.body}>{i.quantity} × {i.name} · {fare(i.priceKobo * i.quantity)}</Text>)}<FoodMoney value={o.totals}/><Text style={styles.small}>Test checkout · no money charged.</Text></Card>
      <Card><Text style={styles.h2}>Order progress</Text>{o.events.map((e, i) => <View key={i} style={food.timeline}><Text style={styles.body}>{EATS_STATUS[e.status]}</Text><Text style={styles.small}>{new Date(e.at).toLocaleString()}</Text>{e.reason && <Text style={styles.body}>{e.reason}</Text>}</View>)}</Card>
    </>}
    <Button title="Refresh order" secondary busy={s.loading} disabled={s.busy || s.uncertain} onPress={() => void c.refresh()}/>
    <Button title={o?.role === 'store' ? 'Return to My store' : o?.role === 'courier' ? 'Return to food deliveries' : 'My food orders'} secondary disabled={s.busy || s.uncertain} onPress={() => router.replace(o?.role === 'store' ? '/my-store' : o?.role === 'courier' ? '/food-work' : { pathname: '/eats', params: { section: 'orders' } })}/>
  </Screen>;
}
