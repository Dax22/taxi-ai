import { MealBuilder } from '../src/eats/meal-builder';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Text } from '../src/ui/typography';
import { router, useLocalSearchParams } from 'expo-router';
import { EATS_SELLERS, foodAvailable, foodStock, discoverKitchens, isPrivateKitchen } from '../../../packages/shared/src/eats.mjs';
import type { FoodFulfillment } from '../../../packages/shared/src/eats.mjs';
import { useEatsScreen } from '../src/eats/provider';
import { FoodFeedback, FoodMoney, FoodOrders, FoodPreview, food } from '../src/eats/components';
import { CuisineChips, DiscoveryChip, FoodHero, FoodPhoto, discovery } from '../src/eats/discovery';
import { Button, Card, Field, Heading, Pill, Screen, fare, styles } from '../src/ui/components';
import { SelectField } from '../src/ui/select-field';
import { FoodLocationFields, foodLocationLabel } from '../src/eats/location-fields';

export default function Eats() {
  const params = useLocalSearchParams<{ section?: string }>(), screen = params.section === 'orders' ? 'orders' : 'browse';
  const { state: s, controller: c, locked } = useEatsScreen(screen);
  const [menusOpen, setMenusOpen] = useState(false);
  const [query, setQuery] = useState(''), [cuisine, setCuisine] = useState(''), [area, setArea] = useState(''), [sellerType, setSellerType] = useState('');
  const [openOnly, setOpenOnly] = useState(false), [sort, setSort] = useState('recommended'), [detail, setDetail] = useState(false), [limit, setLimit] = useState(24);
  const [filtersOpen, setFiltersOpen] = useState(false), [addressOpen, setAddressOpen] = useState(false), [filterKey, setFilterKey] = useState(0);
  useEffect(() => {
    setMenusOpen(false); setDetail(false); setFiltersOpen(false); setAddressOpen(false);
    setQuery(''); setCuisine(''); setArea(''); setSellerType(''); setOpenOnly(false); setSort('recommended'); setLimit(24); setFilterKey((value) => value + 1);
  }, [s.user?.id]);
  const admin = s.user?.role === 'admin', navigating = s.busy || s.uncertain;
  const home = () => router.push({ pathname: '/my-store', params: { type: 'home_kitchen' } });
  const areaName = foodLocationLabel;
  async function select(id: string, replace = false) { if (await c.selectRestaurant(id, replace)) setDetail(true); }
  const restaurants = discoverKitchens(s.restaurants, { q: query, cuisine, areaId: area, sellerType, fulfillment: s.fulfillment, openOnly, sort });
  const modeAvailable = s.restaurant && (s.fulfillment === 'pickup' ? s.restaurant.pickupEnabled : s.restaurant.deliveryEnabled !== false);
  return <Screen><Pill>TAXI AI EATS · NIGERIA</Pill><FoodPreview/>
    <View style={styles.row}><Button title="Discover" secondary disabled={navigating} onPress={() => { setDetail(false); setMenusOpen(false); router.setParams({ section: 'browse' }); if (screen === 'browse') void c.navigate('browse'); }}/><Button title="My food orders" secondary disabled={navigating} onPress={() => router.setParams({ section: 'orders' })}/></View>
    <FoodFeedback state={s} controller={c}/>
    {screen === 'orders' ? <><Heading title="Good food, on its way." subtitle="Current orders and your food history."/><FoodOrders orders={s.orders}/>{s.nextBefore && <Button title="Load older orders" secondary disabled={locked || s.loading} onPress={() => void c.refresh({ before: s.nextBefore })}/>}</> : <>
      {!menusOpen || !s.deliveryConfirmed ? <MealBuilder key={s.user?.id} state={s} controller={c} locked={locked} onMenus={() => { setMenusOpen(true); setDetail(false); setArea(s.catalogAreaId); setFilterKey((value) => value + 1); }} onPlaced={() => router.setParams({ section: 'orders' })}/> : <>
      <Button title="Back to building my meal" secondary disabled={navigating} onPress={() => setMenusOpen(false)}/>
      {!detail && <>
        <View style={styles.row}><DiscoveryChip label="Delivery" selected={s.fulfillment === 'delivery'} disabled={navigating} onPress={() => { c.fulfillment('delivery'); setLimit(24); }}/><DiscoveryChip label="Pickup" selected={s.fulfillment === 'pickup'} disabled={navigating} onPress={() => { c.fulfillment('pickup'); setLimit(24); }}/>{!admin && <DiscoveryChip label="Sell from home" disabled={navigating} onPress={home}/>}</View>
        {s.fulfillment === 'delivery' && <>
          <DiscoveryChip label={s.address.line ? `Deliver to: ${s.address.line}` : 'Add a delivery address'} expanded={addressOpen} disabled={navigating} onPress={() => setAddressOpen(!addressOpen)}/>
          {addressOpen && <><Field label="Where are we eating?" value={s.address.line} onChangeText={(line) => c.delivery({ ...s.address, line }, s.instructions)} placeholder="Delivery address and landmark" maxLength={240} editable={!navigating}/><Text style={styles.body}>{areaName(s.address.areaId)}</Text><Button title="Change delivery location" secondary disabled={navigating} onPress={() => { c.editDelivery(); setMenusOpen(false); setDetail(false); }}/></>}
        </>}
        <Field label="Find your next favourite" value={query} onChangeText={(v) => { setQuery(v); setLimit(24); }} placeholder="Kitchen or cuisine" maxLength={100}/>
        <CuisineChips value={cuisine} onChange={(v) => { setCuisine(v); setLimit(24); }}/>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={discovery.controls}>
          {[{ value: '', label: 'All kitchens' }, { value: 'home_kitchen', label: 'Home kitchens' }, { value: 'restaurant', label: 'Restaurants' }, { value: 'food_vendor', label: 'Food vendors' }].map((option) => <DiscoveryChip key={option.value} label={option.label} selected={sellerType === option.value} onPress={() => { setSellerType(option.value); setLimit(24); }}/>) }
          <DiscoveryChip label="Open now" selected={openOnly} onPress={() => { setOpenOnly(!openOnly); setLimit(24); }}/>
          <DiscoveryChip label={area || sort !== 'recommended' ? 'Filters · active' : 'Filters'} selected={filtersOpen || Boolean(area) || sort !== 'recommended'} expanded={filtersOpen} onPress={() => setFiltersOpen(!filtersOpen)}/>
        </ScrollView>
        {filtersOpen && <Card>
          <FoodLocationFields key={filterKey} label="Kitchen filter" value={area} onChange={(v) => { setArea(v); setLimit(24); }} disabled={navigating || s.loading}/>
          <SelectField label="Sort by" value={sort} onChange={(v) => { setSort(v); setLimit(24); }} options={[{ value: 'recommended', label: 'Kitchen name · open kitchens first' }, { value: 'prep', label: 'Preparation time' }, { value: 'fee', label: 'Delivery fee' }]}/>
          <Text style={styles.small}>Kitchen area filters where the food is prepared. It does not set your delivery area.</Text>
          <View style={styles.row}><Button title="Clear filters" secondary disabled={navigating || s.loading} onPress={() => { setQuery(''); setCuisine(''); setSellerType(''); setArea(''); setSort('recommended'); setOpenOnly(false); setLimit(24); setFilterKey((value) => value + 1); void c.browseLocation(''); }}/><Button title="Show kitchens" busy={s.loading} disabled={navigating || s.loading} onPress={() => { void c.browseLocation(area).then((ok) => { if (ok) setFiltersOpen(false); }); }}/></View>
        </Card>}
        <FoodHero/>
        <Heading title="Find something delicious." subtitle={`${restaurants.length} ${restaurants.length === 1 ? 'kitchen' : 'kitchens'} · ${s.fulfillment === 'pickup' ? 'Customer pickup' : 'Delivery'}`}/>
        {!s.loading && !restaurants.length && <Card><Text style={styles.h2}>{s.restaurants.length ? 'Let’s try another craving.' : 'Make room at the table.'}</Text><Text style={styles.body}>{s.restaurants.length ? 'Try another area, cuisine, kitchen type or order option.' : 'The first kitchens are on their way. Create a test home kitchen, add a menu and complete staff review to explore the full ordering flow.'}</Text>{!admin && <Button title="Start a home kitchen" secondary disabled={navigating} onPress={home}/>}</Card>}
        {restaurants.slice(0, limit).map((r) => <Card key={r.id}>
          <FoodPhoto id={r.coverPhotoId} controller={c} label={`${r.name} · photo supplied by the kitchen`}/>
          {r.logoPhotoId && <FoodPhoto id={r.logoPhotoId} controller={c} label={`${r.name} logo`} compact contain/>}
          <Text style={styles.label}>{EATS_SELLERS[r.sellerType ?? 'restaurant']}</Text><Text style={styles.h2}>{r.name}</Text><Pill>{r.isOpen ? 'OPEN FOR TEST ORDERS' : 'CLOSED'}</Pill><Text style={styles.body}>{r.description}</Text><Text style={styles.small}>{r.cuisine} · {areaName(r.areaId)}</Text>{!isPrivateKitchen(r.sellerType) && !r.addressHidden && <Text style={styles.small}>{r.address}</Text>}<Text style={styles.small}>{r.prepMinutes} min preparation · {s.fulfillment === 'pickup' ? 'Pickup · no delivery fee' : `${fare(r.deliveryFeeKobo)} delivery`}</Text><Button title={`View ${r.name} menu`} disabled={locked} onPress={() => void select(r.id)}/>
        </Card>)}
        {restaurants.length > limit && <Button title="Show more kitchens" secondary onPress={() => setLimit(limit + 24)}/>}
        {!!s.cart.length && s.restaurant && <Button title={`Return to ${s.restaurant.name} cart`} secondary disabled={navigating} onPress={() => setDetail(true)}/>}
        {!admin && <View style={discovery.seller}><Text style={styles.label}>YOUR RECIPE. YOUR OPPORTUNITY.</Text><Text style={styles.h2}>Turn your home cooking into a little extra.</Text><Text style={styles.body}>Set your menu, price each portion and choose when you’re open. We’ll make room for your kitchen.</Text><Button title="Sell from home" disabled={navigating} onPress={home}/></View>}
      </>}
      {s.replaceRestaurantId && <Card><Text style={styles.h2}>Start a new cart?</Text><Text style={styles.body}>Each order comes from one kitchen. This replaces the items in your current cart.</Text><Button title="Replace cart" disabled={locked} onPress={() => void select(s.replaceRestaurantId!, true)}/><Button title="Keep my cart" secondary disabled={navigating} onPress={c.keepRestaurant}/></Card>}
      {detail && s.restaurant && <>
        <Button title="Back to kitchens" secondary disabled={navigating} onPress={() => setDetail(false)}/>
        {s.restaurant.coverPhotoId && <FoodPhoto id={s.restaurant.coverPhotoId} controller={c} label={`${s.restaurant.name} cover photo`}/>}
        {s.restaurant.logoPhotoId && <FoodPhoto id={s.restaurant.logoPhotoId} controller={c} label={`${s.restaurant.name} logo`} compact contain/>}
        <Pill>{EATS_SELLERS[s.restaurant.sellerType ?? 'restaurant'].toUpperCase()}</Pill><Heading title={s.restaurant.name} subtitle={s.restaurant.description}/>
        <Text style={styles.body}>{isPrivateKitchen(s.restaurant.sellerType) || s.restaurant.addressHidden ? `${areaName(s.restaurant.areaId)} · Private collection point shared with the assigned courier or pickup customer when food is ready.` : s.restaurant.address}</Text>
        <Text style={styles.small}>{s.restaurant.prepMinutes} min preparation · Minimum {fare(s.restaurant.minimumKobo)} · {s.restaurant.isOpen ? 'Open for test orders' : 'Closed'}</Text>
        <Text style={styles.small}>Ingredients and allergen information are supplied by the kitchen. Special requests are not guaranteed; confirm dietary requirements before ordering.</Text>
        {s.menu.map((item) => { const quantity = s.cart.find((i) => i.itemId === item.id)?.quantity ?? 0; return <View key={item.id} style={food.menuRow}>
          <FoodPhoto id={item.photoId} revision={item.photoVersion} controller={c} label={item.name} compact/><Pill>{item.category.toUpperCase()}</Pill><Text style={styles.h2}>{item.name}</Text><Text style={styles.body}>{item.description}</Text>{!!item.allergens && <Text style={styles.small}>Allergens: {item.allergens}</Text>}<Text style={styles.body}>{fare(item.priceKobo)}</Text><Text style={styles.small}>{foodStock(item)}</Text>
          <View style={food.quantity}><Button title={`− ${item.name}`} secondary disabled={locked || quantity === 0} onPress={() => c.quantity(item.id, quantity - 1)}/><Text accessibilityLiveRegion="polite" style={styles.body}>{quantity}</Text><Button title={`+ ${item.name}`} disabled={locked || quantity >= Math.min(20, item.portionsRemaining ?? 20) || !foodAvailable(item) || !s.restaurant?.isOpen} onPress={() => c.quantity(item.id, quantity + 1)}/></View>
        </View>; })}
        <Card><Heading title="Your cart."/>{!s.cart.length && <Text style={styles.body}>Choose something delicious from the menu.</Text>}
          {s.cart.map((line) => { const item = s.menu.find((i) => i.id === line.itemId); return <View key={line.itemId} style={styles.stack}><Text style={styles.body}>{line.quantity} × {item?.name ?? 'Unavailable item'}{item ? ` · ${fare(item.priceKobo * line.quantity)}` : ' · Remove before checkout'}</Text><Button title={`Remove ${item?.name ?? 'item'}`} secondary disabled={navigating} onPress={() => c.quantity(line.itemId, 0)}/></View>; })}
          <SelectField label="How would you like your food?" value={s.fulfillment} onChange={(v) => c.fulfillment(v as FoodFulfillment)} disabled={navigating} options={[{ value: 'delivery', label: 'Delivery', disabled: s.restaurant.deliveryEnabled === false }, { value: 'pickup', label: 'Customer pickup · no delivery fee', disabled: !s.restaurant.pickupEnabled }]}/>
          {!modeAvailable && <Text style={styles.body}>Choose an order option offered by this kitchen.</Text>}
          {s.fulfillment === 'pickup' ? <Text style={styles.body}>Collect your food yourself. Food vendors and home kitchens share a private collection point when your food is ready.</Text> : <>
            <Field label="Delivery address and landmark" value={s.address.line} editable={!navigating} onChangeText={(line) => c.delivery({ ...s.address, line }, s.instructions)} maxLength={240} placeholder="Street, building and nearby landmark"/>
            <Text style={styles.body}>{areaName(s.address.areaId)}</Text>
            <Button title="Change delivery location" secondary disabled={navigating} onPress={() => { c.editDelivery(); setMenusOpen(false); setDetail(false); }}/>
          </>}
          <Field label="Kitchen or handover instructions (optional)" value={s.instructions} onChangeText={(value) => c.delivery(s.address, value)} editable={!navigating} multiline maxLength={240}/>
          <Button title="Review total" busy={s.busy} disabled={locked || !s.cart.length || (s.fulfillment !== 'pickup' && (s.address.line.trim().length < 8 || !s.address.areaId)) || !modeAvailable || !s.restaurant.isOpen} onPress={() => void c.checkout()}/>
        </Card>
        {s.quote && <Card><Text style={styles.h2}>Review your order</Text><Text style={styles.body}>{s.quote.fulfillment === 'pickup' ? 'Customer pickup · collect your food yourself.' : `Delivery to ${s.quote.address.line} · ${areaName(s.quote.address.areaId)}`}</Text><FoodMoney value={s.quote.totals}/><Text style={styles.small}>Total held until {new Date(s.quote.expiresAt).toLocaleTimeString()}. Test checkout · no charge. Preparation time excludes delivery.</Text><Button title="Place test order" disabled={locked || s.now >= s.quote.expiresAt} onPress={() => void c.place().then((ok) => { const id = c.snapshot().orderId; if (ok && id) router.push({ pathname: '/food-order', params: { id } }); })}/></Card>}
      </>}
      </>}
    </>}
    <Button title="Refresh Eats" secondary busy={s.loading} disabled={navigating} onPress={() => void c.refresh()}/>
  </Screen>;
}
