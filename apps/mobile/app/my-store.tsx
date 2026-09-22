import { Text } from '../src/ui/typography';
import { useEatsScreen } from '../src/eats/provider';
import { FoodFeedback, FoodOrders, FoodPreview } from '../src/eats/components';
import { StoreForm, MenuForm } from '../src/eats/store-forms';
import { Button, Card, Heading, Pill, Screen, styles } from '../src/ui/components';
export default function MyStore() {
  const { state: s, controller: c, locked } = useEatsScreen('store');
  return <Screen><Pill>MY STORE · TAXI AI EATS</Pill><Heading title="Your kitchen. Your community." subtitle="Manage your menu and incoming orders from the same account."/><FoodPreview/><FoodFeedback state={s} controller={c}/>
    {s.store && <Card><Text style={styles.h2}>{s.store.name}</Text><Pill>{s.store.status.toUpperCase()}</Pill><Text style={styles.body}>{s.store.reviewNote || 'Add a menu, complete staff review, then open for test orders.'}</Text><Text style={styles.body}>{s.store.isOpen ? 'Open for new orders' : 'Closed to new orders'}</Text>
      {s.store.status === 'approved' && <Button title={s.store.isOpen ? 'Close to new orders' : 'Open for test orders'} disabled={locked} onPress={() => void c.storeAction('open', { isOpen: !s.store!.isOpen })}/>}<Text style={styles.small}>Closing pauses new orders. Orders already accepted still need fulfillment.</Text></Card>}
    {!!s.areas.length && <StoreForm key={s.store?.id ?? 'new-store'} store={s.store} areas={s.areas} controller={c} locked={locked}/>}
    {s.store && <MenuForm store={s.store} items={s.storeMenu} controller={c} locked={locked}/>}
    <Text style={styles.h2}>Kitchen orders</Text><Text style={styles.small}>Accept the order, start preparation, then mark it ready. Give the pickup code only to the assigned courier when handing over the food.</Text><FoodOrders orders={s.storeOrders} empty="Incoming orders will appear while your store is open."/>
    {s.storeNextBefore && <Button title="Load more kitchen orders" secondary disabled={locked || s.loading} onPress={() => void c.refresh({ before: s.storeNextBefore })}/>}
    <Button title="Refresh My store" secondary busy={s.loading} disabled={s.busy || s.uncertain} onPress={() => void c.refresh()}/>
  </Screen>;
}
