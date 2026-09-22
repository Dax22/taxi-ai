import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '../src/ui/typography';
import { router, useLocalSearchParams } from 'expo-router';
import { EATS_CUISINES, EATS_COLOURS, EATS_SYMBOLS } from '../../../packages/shared/src/eats.mjs';
import { useEatsScreen } from '../src/eats/provider';
import { FoodFeedback, FoodMoney, FoodOrders, FoodPreview, food } from '../src/eats/components';
import { Button, Card, Field, Heading, Pill, Screen, fare, styles } from '../src/ui/components';
import { SelectField } from '../src/ui/select-field';
export default function Eats() {
  const params = useLocalSearchParams<{ section?: string }>(), screen = params.section === 'orders' ? 'orders' : 'browse';
  const { state: s, controller: c, locked } = useEatsScreen(screen);
  const [query, setQuery] = useState(''), [cuisine, setCuisine] = useState(''), [detail, setDetail] = useState(false);
  async function select(id: string, replace = false) { if (await c.selectRestaurant(id, replace)) setDetail(true); }
  const restaurants = s.restaurants.filter((r) => (!cuisine || r.cuisine === cuisine) && `${r.name} ${r.cuisine} ${r.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <Screen><Pill>TAXI AI EATS · ABUJA</Pill><FoodPreview/>
    <View style={styles.row}><Button title="Discover" secondary disabled={s.busy || s.uncertain} onPress={() => { setDetail(false); router.setParams({ section: 'browse' }); if (screen === 'browse') void c.navigate('browse'); }}/><Button title="My food orders" secondary disabled={s.busy || s.uncertain} onPress={() => router.setParams({ section: 'orders' })}/></View>
    <FoodFeedback state={s} controller={c}/>
    {screen === 'orders' ? <><Heading title="Good food, on its way." subtitle="Current orders and your food history."/><FoodOrders orders={s.orders}/>{s.nextBefore && <Button title="Load older orders" secondary disabled={locked || s.loading} onPress={() => void c.refresh({ before: s.nextBefore })}/>}</> : <>
      {!detail && <><View style={food.hero}><Text style={styles.label}>ABUJA, SERVED FRESH</Text><Heading title="Your next favourite." subtitle="Local kitchens. Comfort food. A little something for every craving."/></View>
        <Field label="Find a restaurant" value={query} onChangeText={setQuery} placeholder="Restaurant or cuisine" maxLength={100}/>
        <SelectField label="What are you craving?" value={cuisine} onChange={setCuisine} options={[{ value: '', label: 'All cuisines' }, ...EATS_CUISINES.map((name) => ({ value: name, label: name }))]}/>
        {!s.loading && !restaurants.length && <Card><Text style={styles.h2}>The table is being set.</Text><Text style={styles.body}>{s.restaurants.length ? 'Try a different restaurant name or cuisine.' : 'Approved restaurants will appear here. To try the full flow, create a fictional kitchen in My store, add a menu and have an administrator review it.'}</Text><Button title="Open My store" secondary onPress={() => router.push('/my-store')}/></Card>}
        {restaurants.map((r) => <Card key={r.id}><View style={[food.cover, { backgroundColor: EATS_COLOURS[r.cuisine] }]}><Text accessible={false} style={food.symbol}>{EATS_SYMBOLS[r.cuisine]}</Text></View><Pill>{r.isOpen ? 'ACCEPTING TEST ORDERS' : 'CLOSED'}</Pill><Text style={styles.h2}>{r.name}</Text><Text style={styles.body}>{r.description}</Text><Text style={styles.small}>{r.cuisine} · {r.prepMinutes} min preparation · {fare(r.deliveryFeeKobo)} delivery</Text><Button title={`View ${r.name} menu`} disabled={locked} onPress={() => void select(r.id)}/></Card>)}
        {!!s.cart.length && s.restaurant && <Button title={`Return to ${s.restaurant.name} cart`} secondary onPress={() => setDetail(true)}/>}</>}
      {s.replaceRestaurantId && <Card><Text style={styles.h2}>Start a new cart?</Text><Text style={styles.body}>Each order comes from one kitchen. This replaces the items in your current cart.</Text><Button title="Replace cart" disabled={locked} onPress={() => void select(s.replaceRestaurantId!, true)}/><Button title="Keep my cart" secondary onPress={c.keepRestaurant}/></Card>}
      {detail && s.restaurant && <><Button title="Back to restaurants" secondary onPress={() => setDetail(false)}/><Heading title={s.restaurant.name} subtitle={s.restaurant.description}/><Text style={styles.body}>{s.restaurant.address}</Text><Text style={styles.small}>{s.restaurant.prepMinutes} min preparation · Minimum {fare(s.restaurant.minimumKobo)} · {s.restaurant.isOpen ? 'Open for test orders' : 'Closed'}</Text><Text style={styles.small}>Ingredients are supplied by the restaurant. Special requests are not guaranteed; confirm dietary requirements before ordering.</Text>
        {s.menu.map((item) => { const quantity = s.cart.find((i) => i.itemId === item.id)?.quantity ?? 0; return <View key={item.id} style={food.menuRow}><Pill>{item.category.toUpperCase()}</Pill><Text style={styles.h2}>{item.name}</Text><Text style={styles.body}>{item.description}</Text><Text style={styles.body}>{fare(item.priceKobo)}</Text><View style={food.quantity}><Button title={`− ${item.name}`} secondary disabled={locked || quantity === 0} onPress={() => c.quantity(item.id, quantity - 1)}/><Text accessibilityLiveRegion="polite" style={styles.body}>{quantity}</Text><Button title={`+ ${item.name}`} disabled={locked || quantity >= 20 || !s.restaurant?.isOpen} onPress={() => c.quantity(item.id, quantity + 1)}/></View></View>; })}
        <Card><Heading title="Your cart."/>{!s.cart.length && <Text style={styles.body}>Choose something delicious from the menu.</Text>}{s.cart.map((line) => { const item = s.menu.find((i) => i.id === line.itemId); return <View key={line.itemId} style={styles.stack}><Text style={styles.body}>{line.quantity} × {item?.name ?? 'Unavailable item'}{item ? ` · ${fare(item.priceKobo * line.quantity)}` : ' · Remove before checkout'}</Text><Button title={`Remove ${item?.name ?? 'item'}`} secondary disabled={s.busy || s.uncertain} onPress={() => c.quantity(line.itemId, 0)}/></View>; })}
          <Field label="Delivery address and landmark" value={s.address.line} editable={!s.busy && !s.uncertain} onChangeText={(line) => c.delivery({ ...s.address, line }, s.instructions)} maxLength={240} placeholder="Street, building and nearby landmark"/>
          <SelectField label="Abuja delivery area" value={s.address.areaId} onChange={(areaId) => c.delivery({ ...s.address, areaId }, s.instructions)} disabled={s.busy || s.uncertain} options={s.areas.map((a) => ({ value: a.id, label: a.name }))}/>
          <Field label="Kitchen or delivery instructions (optional)" value={s.instructions} onChangeText={(value) => c.delivery(s.address, value)} editable={!s.busy && !s.uncertain} multiline maxLength={240}/>
          <Button title="Review total" busy={s.busy} disabled={locked || !s.cart.length || s.address.line.trim().length < 8 || !s.restaurant.isOpen} onPress={() => void c.checkout()}/>
        </Card>
        {s.quote && <Card><Text style={styles.h2}>Review your order</Text><FoodMoney value={s.quote.totals}/><Text style={styles.body}>{s.quote.address.line}</Text><Text style={styles.small}>Total held until {new Date(s.quote.expiresAt).toLocaleTimeString()}. Test checkout · no charge. Preparation time excludes delivery.</Text><Button title="Place test order" disabled={locked || s.now >= s.quote.expiresAt} onPress={() => void c.place().then((ok) => { const id = c.snapshot().orderId; if (ok && id) router.push({ pathname: '/food-order', params: { id } }); })}/></Card>}
      </>}
    </>}
    <Button title="Refresh Eats" secondary busy={s.loading} disabled={s.busy || s.uncertain} onPress={() => void c.refresh()}/>
  </Screen>;
}
