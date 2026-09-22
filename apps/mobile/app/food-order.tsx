import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '../src/ui/typography';
import { useLocalSearchParams, router } from 'expo-router';
import { EATS_STATUS } from '../../../packages/shared/src/eats.mjs';
import type { FoodAction } from '../../../packages/shared/src/eats.mjs';
import { useEatsScreen } from '../src/eats/provider';
import { FoodFeedback, FoodMoney, FoodPreview, food } from '../src/eats/components';
import { Button, Card, Field, Heading, Pill, Screen, fare, styles } from '../src/ui/components';
const labels: Record<FoodAction, string> = { accept: 'Accept order', reject: 'Decline order', prepare: 'Start preparing', ready: 'Ready for pickup', claim: 'Accept delivery', pickup: 'Confirm food collected', arrive: 'I’m at the delivery address', deliver: 'Confirm delivered', cancel: 'Cancel order' };
export default function FoodOrder() {
  const { id } = useLocalSearchParams<{ id: string }>(), { state: s, controller: c, locked } = useEatsScreen('order', id ?? null);
  const [pin, setPin] = useState(''), [reason, setReason] = useState(''); const o = s.order;
  useEffect(() => { setPin(''); setReason(''); }, [id]);
  async function action(value: FoodAction) {
    if (!o) return;
    const extra = ['pickup','deliver'].includes(value) ? { pin } : ['cancel','reject'].includes(value) ? { reason } : {};
    if (await c.orderAction(o, value, extra)) { setPin(''); setReason(''); }
  }
  return <Screen><FoodPreview/><FoodFeedback state={s} controller={c}/>
    {o && <><Pill>{`FOOD ORDER · ${o.id.slice(0,8).toUpperCase()}`}</Pill><Heading title={EATS_STATUS[o.status]} subtitle={o.restaurant.name}/>
      <Card><Text style={styles.h2}>Order details</Text><Text style={styles.body}>Customer · {o.customerName}</Text><Text style={styles.body}>Collect from · {o.restaurant.address}</Text>{o.address.line && <Text style={styles.body}>Deliver to · {o.address.line}</Text>}{!!o.instructions && <Text style={styles.body}>Instructions · {o.instructions}</Text>}
        {o.courier && <><Text style={styles.h2}>Your courier · {o.courier.name}</Text><Text style={styles.body}>{o.courier.vehicle.colour} {o.courier.vehicle.model} · {o.courier.vehicle.plate}</Text></>}
        {(o.pickupPin || o.deliveryPin) && <><Text style={styles.body}>{o.pickupPin ? 'Restaurant pickup code. Share only when handing the food to the assigned courier.' : 'Your delivery code. Share only when you receive the food.'}</Text><Text selectable style={food.pin}>{o.pickupPin ?? o.deliveryPin}</Text></>}
      </Card>
      {!!o.actions.length && <Card><Text style={styles.h2}>Next step</Text>
        {o.actions.some((a) => ['pickup','deliver'].includes(a)) && <><Field label="Six-digit handover code" value={pin} onChangeText={setPin} maxLength={6} keyboardType="number-pad" editable={!locked}/><Text style={styles.small}>Collect the pickup code from the restaurant and the delivery code from the customer, in person.</Text></>}
        {o.actions.some((a) => ['cancel','reject'].includes(a)) && <Field label="Reason (for cancellation or decline)" value={reason} onChangeText={setReason} maxLength={240} editable={!locked}/>}
        {o.actions.map((a) => <Button key={a} title={labels[a]} secondary={['cancel','reject'].includes(a)} disabled={locked || (['pickup','deliver'].includes(a) && !/^\d{6}$/.test(pin)) || (['cancel','reject'].includes(a) && reason.trim().length < 5)} onPress={() => void action(a)}/>)}
      </Card>}
      <Card><Text style={styles.h2}>Your food</Text>{o.lines.map((i) => <Text key={i.itemId} style={styles.body}>{i.quantity} × {i.name} · {fare(i.priceKobo * i.quantity)}</Text>)}<FoodMoney value={o.totals}/><Text style={styles.small}>Test checkout · no money charged.</Text></Card>
      <Card><Text style={styles.h2}>Order progress</Text>{o.events.map((e, i) => <View key={i} style={food.timeline}><Text style={styles.body}>{EATS_STATUS[e.status]}</Text><Text style={styles.small}>{new Date(e.at).toLocaleString()}</Text>{e.reason && <Text style={styles.body}>{e.reason}</Text>}</View>)}</Card>
    </>}
    <Button title="Refresh order" secondary busy={s.loading} disabled={s.busy || s.uncertain} onPress={() => void c.refresh()}/>
    <Button title={o?.role === 'store' ? 'Return to My store' : o?.role === 'courier' ? 'Return to food deliveries' : 'My food orders'} secondary disabled={s.busy || s.uncertain} onPress={() => router.replace(o?.role === 'store' ? '/my-store' : o?.role === 'courier' ? '/food-work' : { pathname: '/eats', params: { section: 'orders' } })}/>
  </Screen>;
}
