import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Text } from '../ui/typography';
import { Button, Card, Field, Heading, Pill, fare, styles } from '../ui/components';
import { foodLocationLabel } from './location-fields';
import { EATS_SELLERS, foodAvailable, foodStock, isPrivateKitchen } from '../../../../packages/shared/src/eats.mjs';
import type { EatsController, EatsState } from '../../../../packages/shared/src/eats-controller.mjs';
import { DiscoveryChip, FoodHero, FoodPhoto, discovery } from './discovery';
import { FoodMoney, FoodRecipientDetails, food } from './components';
import { DeliverySetup } from './delivery-setup';

export function MealBuilder({ state: s, controller: c, locked, onMenus, onPlaced }: { state: EatsState; controller: EatsController; locked: boolean; onMenus(): void; onPlaced(): void }) {
  const [query, setQuery] = useState(s.foodQuery);
  const town = foodLocationLabel;
  const admin = s.user?.role === 'admin';
  const search = (value = query) => { setQuery(value); void c.findMeals(value); };
  return <>
    <FoodHero/>
    {!s.deliveryConfirmed ? <DeliverySetup state={s} controller={c} locked={locked}/> : <>
      <Card><FoodRecipientDetails recipient={s.recipient}/><Text style={styles.label}>DELIVERING TO</Text><Text style={styles.body}>{s.address.line} · {town(s.address.areaId)}</Text><Button title="Change recipient or delivery location" secondary disabled={s.busy || s.uncertain} onPress={() => c.editDelivery()}/></Card>
      <Heading title="What do you want to eat?" subtitle="Mix dishes from restaurants, food vendors and home kitchens."/>
      <Field label="Your craving" value={query} onChangeText={setQuery} placeholder="Jollof rice, chicken and plantain" maxLength={200} returnKeyType="search" onSubmitEditing={() => search()} editable={!locked && !s.foodLoading}/>
      <Button title="Find my food" busy={s.foodLoading} disabled={locked} onPress={() => search()}/>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={discovery.controls}>
        {['Jollof rice', 'Egusi & pounded yam', 'Suya', 'Plantain', 'Moi moi'].map((value) => <DiscoveryChip key={value} label={value} selected={query === value} disabled={locked || s.foodLoading} onPress={() => search(value)}/>)}
      </ScrollView>
      <Text accessibilityLiveRegion="polite" style={styles.small}>{s.foodLoading ? 'Finding dishes for your delivery area…' : `${s.foodCount} available dishes${s.foodQuery ? ` matching “${s.foodQuery}”` : ''} · prices set by the sellers`}</Text>
      {!s.foodLoading && !s.foods.length && <Card><Text style={styles.h2}>Let’s find your next favourite.</Text><Text style={styles.body}>No kitchens currently offer matching dishes for this town or area. Check the spelling of your location or try another dish.</Text></Card>}
      {s.foods.map((option) => {
        const { item, store } = option, quantity = s.mealBasket.find((l) => l.item.id === item.id)?.quantity ?? 0;
        return <Card key={item.id}>
          <FoodPhoto id={item.photoId} revision={item.photoVersion} controller={c} label={item.name}/>
          <Text style={styles.label}>{EATS_SELLERS[store.sellerType ?? 'restaurant']} · {town(store.areaId)}</Text>
          <Text style={styles.h2}>{item.name}</Text><Text style={styles.body}>{store.name}</Text><Text style={styles.small}>{item.description}</Text>
          {!!item.allergens && <Text style={styles.small}>Allergens: {item.allergens}</Text>}
          {!isPrivateKitchen(store.sellerType) && !store.addressHidden && <Text style={styles.small}>{store.address}</Text>}
          <Text style={styles.small}>{store.prepMinutes} min preparation · {fare(store.deliveryFeeKobo)} delivery per kitchen</Text>
          <Text style={styles.h2}>{fare(item.priceKobo)}</Text><Text style={styles.small}>{foodStock(item)}</Text>
          <View style={food.quantity}><Button title={`− ${item.name}`} secondary disabled={locked || !quantity} onPress={() => c.mealQuantity(option, quantity - 1)}/><Text accessibilityLiveRegion="polite" style={styles.body}>{quantity}</Text><Button title={`+ ${item.name}`} disabled={locked || admin || !foodAvailable(item) || quantity >= Math.min(20, item.portionsRemaining ?? 20)} onPress={() => c.mealQuantity(option, quantity + 1)}/></View>
        </Card>;
      })}
      {s.foodNextOffset !== null && <Button title="Show more dishes" secondary busy={s.foodLoading} disabled={locked} onPress={() => void c.findMeals(s.foodQuery, true)}/>}
      <Card><Pill>MIX. MATCH. ENJOY.</Pill><Heading title="Your meal"/>
        {!s.mealBasket.length && <Text style={styles.body}>A little of this. A little of that. Add dishes to build your meal.</Text>}
        {[...new Set(s.mealBasket.map((l) => l.store.id))].map((id) => {
          const lines = s.mealBasket.filter((l) => l.store.id === id), store = lines[0].store;
          return <View key={id} style={food.menuRow}><Text style={styles.h2}>{store.name}</Text>
            {lines.map((line) => <View key={line.item.id} style={styles.stack}><Text style={styles.body}>{line.quantity} × {line.item.name} · {fare(line.quantity * line.item.priceKobo)}</Text><Button title={`Remove ${line.item.name}`} secondary disabled={locked} onPress={() => c.mealQuantity(line, 0)}/></View>)}
            <Text style={styles.small}>Minimum food order {fare(store.minimumKobo)} · {fare(store.deliveryFeeKobo)} delivery</Text>
          </View>;
        })}
        {!!s.mealBasket.length && <Text style={styles.h2}>Food subtotal · {fare(s.mealBasket.reduce((n, l) => n + l.quantity * l.item.priceKobo, 0))}</Text>}
        <Text style={styles.small}>Each kitchen prepares and delivers separately. Review each kitchen’s delivery and service fees below.</Text>
        <Field label="Kitchen or delivery notes (optional)" value={s.instructions} onChangeText={(value) => c.delivery(s.address, value)} maxLength={240} multiline editable={!locked}/>
        <Button title="Review total" busy={s.busy} disabled={locked || s.foodLoading || !s.mealBasket.length || admin} onPress={() => void c.reviewMeal()}/>
      </Card>
      {s.mealCheckout && <Card><Heading title="Review your meal" subtitle={`Delivery to ${s.address.line} · ${town(s.address.areaId)}`}/>
        <FoodRecipientDetails recipient={s.mealCheckout.quotes[0]?.recipient}/>
        {s.mealCheckout.quotes[0]?.recipient?.kind === 'other' && <Text style={styles.small}>After placing the order, share the delivery code privately with the recipient. They should give it to the courier only when receiving the food. No automatic message is sent.</Text>}
        {s.mealCheckout.quotes.map((quote) => <View key={quote.id} style={food.menuRow}><Text style={styles.h2}>{quote.restaurant.name}</Text>{quote.lines.map((line) => <Text key={line.itemId} style={styles.body}>{line.quantity} × {line.name} · {fare(line.quantity * line.priceKobo)}</Text>)}<FoodMoney value={quote.totals}/></View>)}
        <Text style={styles.h2}>Combined total · {fare(s.mealCheckout.totals.totalKobo)}</Text>
        <Text style={styles.small}>Total held until {new Date(s.mealCheckout.expiresAt).toLocaleTimeString()}. Separate deliveries from each kitchen. Test checkout · no real money is collected.</Text>
        <Button title={`Place ${s.mealCheckout.quotes.length === 1 ? 'test order' : `${s.mealCheckout.quotes.length} test orders`}`} disabled={locked || s.now >= s.mealCheckout.expiresAt} onPress={() => void c.placeMeal().then((ok) => { if (ok) onPlaced(); })}/>
      </Card>}
      <Button title="Kitchen menus & customer pickup" secondary disabled={s.busy || s.uncertain} onPress={onMenus}/>
      <Text style={styles.small}>Place a separate order directly from one kitchen, or use Your meal above to combine dishes for delivery.</Text>
    </>}
    {!admin && <View style={discovery.seller}><Text style={styles.label}>YOUR RECIPE. YOUR OPPORTUNITY.</Text><Text style={styles.h2}>Turn your home cooking into a little extra.</Text><Text style={styles.body}>Add your dishes, set your prices and list your town. Your home address stays off your public profile.</Text><Button title="Sell from home" disabled={s.busy || s.uncertain} onPress={() => router.push({ pathname: '/my-store', params: { type: 'home_kitchen' } })}/></View>}
  </>;
}
