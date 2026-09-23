import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Text } from '../src/ui/typography';
import { router, useLocalSearchParams } from 'expo-router';
import { EATS_CUISINES } from '../../../packages/shared/src/eats.mjs';
import type { FoodDish, FoodMenuItem, FoodStore } from '../../../packages/shared/src/eats.mjs';
import type { EatsController, EatsState } from '../../../packages/shared/src/eats-controller.mjs';
import { useEatsScreen } from '../src/eats/provider';
import { FoodFeedback, FoodMoney, FoodOrders, FoodPreview } from '../src/eats/components';
import { Button, Card, Field, Heading, Pill, Screen, fare, styles } from '../src/ui/components';
import { SelectField } from '../src/ui/select-field';
import { useSession } from '../src/session/provider';
import tableImage from '../src/assets/eats-nigerian-table.jpg';
import jollofImage from '../src/assets/eats-jollof.jpg';
import egusiImage from '../src/assets/eats-egusi.jpg';
import suyaImage from '../src/assets/eats-suya.jpg';

const sellerLocation = (seller: { sellerType?: string; address?: string; town?: string }) =>
  seller.sellerType === 'restaurant' || !seller.sellerType ? seller.address ?? '' : seller.town ?? '';
const dishImage = (name: string) => /jollof/i.test(name) ? jollofImage : /egusi|pounded yam/i.test(name) ? egusiImage : /suya/i.test(name) ? suyaImage : tableImage;
function DishPhoto({ item }: { item: FoodMenuItem }) {
  const { client } = useSession();
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [item.id, item.photoVersion]);
  const uploaded = Boolean(item.photoVersion) && !failed;
  return <Image source={uploaded ? client.eatsImageSource(item.id, item.photoVersion!) : dishImage(item.name)}
    onError={() => setFailed(true)} style={look.dishImage}
    accessibilityLabel={uploaded ? `${item.name} photo from the seller` : `Illustrative overhead food photo for ${item.name}`}/>;
}
const sellerKind = (seller: FoodStore) => seller.sellerType === 'private_kitchen' ? 'PRIVATE KITCHEN' : seller.sellerType === 'vendor' ? 'VENDOR' : 'RESTAURANT';

function DeliveryLocation({ state: s, controller: c, locked }: { state: EatsState; controller: EatsController; locked: boolean }) {
  return <Card><Pill>STEP 1 · DELIVERY LOCATION</Pill><Text style={styles.h2}>Where should we bring your food?</Text>
    {s.deliveryConfirmed ? <><Text style={styles.body}>{s.address.line}</Text><Text style={styles.small}>{s.areas.find((area) => area.id === s.address.areaId)?.name}</Text>
      <Button title="Change delivery location" secondary disabled={locked} onPress={() => c.changeDelivery()}/></> : <>
      <Text style={styles.small}>Enter your street, building and landmark before searching for food.</Text>
      <Field label="Delivery address and landmark" value={s.address.line} onChangeText={(line) => c.delivery({ ...s.address, line }, s.instructions)} maxLength={240} placeholder="Street, building, nearby landmark" editable={!locked}/>
      <SelectField label="Abuja area" value={s.address.areaId} onChange={(areaId) => c.delivery({ ...s.address, areaId }, s.instructions)} disabled={locked} options={s.areas.map((area) => ({ value: area.id, label: area.name }))}/>
      <Button title="Show food near me" disabled={locked || s.address.line.trim().length < 8 || !s.areas.length} onPress={() => c.confirmDelivery()}/>
    </>}
  </Card>;
}
function DishCard({ dish, locked, onOpen }: { dish: FoodDish; locked: boolean; onOpen(): void }) {
  return <Card><View style={look.dishRow}><DishPhoto item={dish}/>
    <View style={look.dishInfo}><Text style={styles.h2}>{dish.name}</Text><Text style={styles.small}>{dish.seller.name} · {sellerLocation(dish.seller)}</Text>
      <Text style={styles.body}>{fare(dish.priceKobo)}</Text></View></View>
    {!!dish.description && <Text style={styles.small}>{dish.description}</Text>}
    <Button title={dish.seller.isOpen ? 'View dish & menu' : 'Kitchen closed'} disabled={locked || !dish.seller.isOpen} onPress={onOpen}/>
  </Card>;
}
function Discover({ state: s, controller: c, locked }: { state: EatsState; controller: EatsController; locked: boolean }) {
  const [query, setQuery] = useState(''), [cuisine, setCuisine] = useState(''), [detail, setDetail] = useState(false);
  useEffect(() => { if (query === s.query) return; const timer = setTimeout(() => void c.search(query), 280); return () => clearTimeout(timer); }, [query, s.query, c]);
  useEffect(() => { if (!s.deliveryConfirmed) setDetail(false); }, [s.deliveryConfirmed]);
  async function select(id: string, replace = false) { if (await c.selectRestaurant(id, replace)) setDetail(true); }
  const dishes = s.dishes.filter((dish) => !cuisine || dish.seller.cuisine === cuisine);
  const sellers = s.restaurants.filter((seller) => !cuisine || seller.cuisine === cuisine);
  return <>
    <View style={look.hero}><View style={look.heroCopy}><Text style={styles.label}>TAXI AI EATS · ABUJA</Text><Text style={look.heroTitle}>Good food, right to your door.</Text>
      <Text style={styles.body}>Nigerian favourites from local restaurants, vendors and private kitchens.</Text></View>
      <Image source={tableImage} style={look.heroImage} accessibilityLabel="Overhead view of jollof rice, suya, egusi, pounded yam, moi-moi and puff-puff"/></View>
    <DeliveryLocation state={s} controller={c} locked={locked}/>
    {s.deliveryConfirmed && <>
      {!detail && <>
        <Field label="STEP 2 · WHAT WOULD YOU LIKE TO EAT?" value={query} onChangeText={setQuery} placeholder="Try jollof rice, suya or egusi" maxLength={100} editable={!locked}/>
        <SelectField label="Cuisine" value={cuisine} onChange={setCuisine} options={[{ value: '', label: 'All cuisines' }, ...EATS_CUISINES.map((name) => ({ value: name, label: name }))]} disabled={locked}/>
        <Heading title="Made for your craving." subtitle="Real menu items from approved kitchens."/>
        {!s.loading && !dishes.length && <Card><Text style={styles.body}>{query ? 'No menu items match yet. Try another dish or cuisine.' : 'Approved kitchens will appear here as they add dishes.'}</Text></Card>}
        {dishes.map((dish) => <DishCard key={`${dish.seller.id}:${dish.id}`} dish={dish} locked={locked} onOpen={() => void select(dish.seller.id)}/>)}
        <Heading title="Explore local kitchens." subtitle="Find a seller you’ll love."/>
        {!s.loading && !sellers.length && <Card><Text style={styles.body}>No approved sellers match this search yet.</Text></Card>}
        {sellers.map((seller) => <Card key={seller.id}><Image source={tableImage} style={look.sellerImage} accessibilityLabel="Overhead photograph of Nigerian dishes"/>
          <Pill>{`${sellerKind(seller)} · ${seller.isOpen ? 'OPEN' : 'CLOSED'}`}</Pill><Text style={styles.h2}>{seller.name}</Text>
          <Text style={styles.body}>{sellerLocation(seller)}</Text><Text style={styles.small}>{seller.cuisine} · {seller.prepMinutes} min preparation · {fare(seller.deliveryFeeKobo)} delivery</Text>
          <Button title={`View ${seller.name} menu`} disabled={locked} onPress={() => void select(seller.id)}/></Card>)}
        {!!s.cart.length && s.restaurant && <Button title={`Return to ${s.restaurant.name} cart`} secondary onPress={() => setDetail(true)}/>}
      </>}
      {s.replaceRestaurantId && <Card><Text style={styles.h2}>Start a new cart?</Text><Text style={styles.body}>This preview checks out one kitchen at a time. Switching sellers replaces your current items.</Text>
        <Button title="Replace cart" disabled={locked} onPress={() => void select(s.replaceRestaurantId!, true)}/><Button title="Keep my cart" secondary onPress={c.keepRestaurant}/></Card>}
      {detail && s.restaurant && <><Button title="Back to food search" secondary onPress={() => setDetail(false)}/>
        <Image source={tableImage} style={look.sellerImage} accessibilityLabel="Overhead photograph of Nigerian dishes"/>
        <Heading title={s.restaurant.name} subtitle={s.restaurant.description}/><Text style={styles.body}>{sellerLocation(s.restaurant)}</Text>
        <Text style={styles.small}>{s.restaurant.prepMinutes} min preparation · Minimum {fare(s.restaurant.minimumKobo)} · {s.restaurant.isOpen ? 'Open for test orders' : 'Closed'}</Text>
        <Text style={styles.small}>Confirm ingredients and dietary requirements directly with the kitchen before ordering.</Text>
        {s.menu.map((item) => { const quantity = s.cart.find((line) => line.itemId === item.id)?.quantity ?? 0; return <Card key={item.id}>
          <View style={look.dishRow}><DishPhoto item={item}/>
            <View style={look.dishInfo}><Pill>{item.category.toUpperCase()}</Pill><Text style={styles.h2}>{item.name}</Text><Text style={styles.body}>{fare(item.priceKobo)}</Text></View></View>
          <Text style={styles.small}>{item.description}</Text><View style={styles.row}><Button title={`− ${item.name}`} secondary disabled={locked || quantity === 0} onPress={() => c.quantity(item.id, quantity - 1)}/>
            <Text accessibilityLiveRegion="polite" style={styles.body}>{quantity}</Text><Button title={`+ ${item.name}`} disabled={locked || quantity >= 20 || !s.restaurant?.isOpen} onPress={() => c.quantity(item.id, quantity + 1)}/></View>
        </Card>; })}
        <Card><Heading title="Your basket."/>{!s.cart.length && <Text style={styles.body}>Choose something delicious from the menu.</Text>}
          {s.cart.map((line) => { const item = s.menu.find((menuItem) => menuItem.id === line.itemId); return <View key={line.itemId} style={styles.stack}>
            <Text style={styles.body}>{line.quantity} × {item?.name ?? 'Unavailable item'}{item ? ` · ${fare(item.priceKobo * line.quantity)}` : ''}</Text>
            <Button title={`Remove ${item?.name ?? 'item'}`} secondary disabled={locked} onPress={() => c.quantity(line.itemId, 0)}/></View>; })}
          <Text style={styles.small}>Delivering to {s.address.line} · {s.areas.find((area) => area.id === s.address.areaId)?.name}</Text>
          <Field label="Kitchen or delivery instructions (optional)" value={s.instructions} onChangeText={(instructions) => c.delivery(s.address, instructions)} multiline maxLength={240} editable={!locked}/>
          <Button title="Review total" busy={s.busy} disabled={locked || !s.cart.length || !s.restaurant.isOpen} onPress={() => void c.checkout()}/>
        </Card>
        {s.quote && <Card><Text style={styles.h2}>Review your order</Text><FoodMoney value={s.quote.totals}/><Text style={styles.body}>{s.quote.address.line}</Text>
          <Text style={styles.small}>Total held until {new Date(s.quote.expiresAt).toLocaleTimeString()}. Test checkout · no charge.</Text>
          <Button title="Place test order" disabled={locked || s.now >= s.quote.expiresAt} onPress={() => void c.place().then((ok) => { const id = c.snapshot().orderId; if (ok && id) router.push({ pathname: '/food-order', params: { id } }); })}/></Card>}
      </>}
    </>}
  </>;
}
export default function Eats() {
  const params = useLocalSearchParams<{ section?: string }>(), screen = params.section === 'orders' ? 'orders' : 'browse';
  const { state: s, controller: c, locked } = useEatsScreen(screen);
  return <Screen><FoodPreview/><View style={styles.row}><Button title="Discover" secondary disabled={s.busy || s.uncertain} onPress={() => router.setParams({ section: 'browse' })}/>
    <Button title="My food orders" secondary disabled={s.busy || s.uncertain} onPress={() => router.setParams({ section: 'orders' })}/></View>
    <FoodFeedback state={s} controller={c}/>
    {screen === 'orders' ? <><Heading title="Good food, on its way." subtitle="Current orders and your food history."/><FoodOrders orders={s.orders}/>
      {s.nextBefore && <Button title="Load older orders" secondary disabled={locked || s.loading} onPress={() => void c.refresh({ before: s.nextBefore })}/>}</>
      : <Discover state={s} controller={c} locked={locked}/>}
    <Button title="Refresh Eats" secondary busy={s.loading} disabled={s.busy || s.uncertain} onPress={() => void c.refresh()}/>
  </Screen>;
}
const look = StyleSheet.create({
  hero: { borderRadius: 24, overflow: 'hidden', backgroundColor: '#faf1df', marginVertical: 10 },
  heroCopy: { padding: 24, gap: 8 }, heroTitle: { fontSize: 34, lineHeight: 38, letterSpacing: -1.2, fontWeight: '700', color: '#171a18' },
  heroImage: { width: '100%', height: 210 }, sellerImage: { width: '100%', height: 176, borderRadius: 16, marginBottom: 12 },
  dishRow: { flexDirection: 'row', gap: 14, alignItems: 'center' }, dishImage: { width: 94, height: 94, borderRadius: 14 },
  dishInfo: { flex: 1, gap: 5 },
});
