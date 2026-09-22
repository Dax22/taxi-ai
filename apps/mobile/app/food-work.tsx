import { Text } from '../src/ui/typography';
import { router } from 'expo-router';
import { useEatsScreen } from '../src/eats/provider';
import { FoodFeedback, FoodOrders, FoodPreview } from '../src/eats/components';
import { Button, Card, Heading, Screen, fare, styles } from '../src/ui/components';
export default function FoodWork() {
  const { state: s, controller: c, locked } = useEatsScreen('work');
  return <Screen><Heading title="Bring something good." subtitle="Collect ready food orders and deliver them around Abuja."/><FoodPreview/><FoodFeedback state={s} controller={c}/>
    {!s.work?.online && !s.work?.current.length && <Card><Text style={styles.body}>{s.work?.eligible ? 'Go online in Work to see ready food orders. You can hold one ride, parcel job or food delivery at a time.' : 'A currently approved motorcycle, car, SUV or van is required for food deliveries.'}</Text><Button title="Open Work availability" secondary onPress={() => router.push('/work')}/></Card>}
    <Text style={styles.h2}>Your current food delivery</Text><FoodOrders orders={s.work?.current ?? []} empty="No food delivery in progress."/>
    <Text style={styles.h2}>Ready for collection</Text><Text style={styles.small}>Pickup and drop-off areas are shown before you accept. The customer’s address is shared after assignment. Fees shown are test amounts, not a payout.</Text>
    {s.work?.online && !s.work.available.length && <Text style={styles.body}>No eligible ready orders. This screen refreshes while it is open.</Text>}
    {s.work?.available.map((job) => <Card key={job.id}><Text style={styles.h2}>{job.restaurant.name}</Text><Text style={styles.body}>{job.restaurant.addressHidden ? `${job.restaurant.areaId} · Home address shown after assignment` : job.restaurant.address} → {job.deliveryArea.name}</Text><Text style={styles.body}>Delivery fee · {fare(job.deliveryFeeKobo)}</Text><Button title="Accept food delivery" disabled={locked} onPress={() => void c.orderAction(job, 'claim').then((ok) => { if (ok) router.push({ pathname: '/food-order', params: { id: job.id } }); })}/></Card>)}
    <Button title="Refresh food deliveries" secondary busy={s.loading} disabled={s.busy || s.uncertain} onPress={() => void c.refresh()}/>
  </Screen>;
}
