import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '../ui/typography';
import { EATS_CUISINES, foodStock, isPrivateKitchen } from '../../../../packages/shared/src/eats.mjs';
import type { FoodArea, FoodMenuItem, FoodStore, FoodSellerType } from '../../../../packages/shared/src/eats.mjs';
import type { EatsController } from '../../../../packages/shared/src/eats-controller.mjs';
import { Button, Card, Field, Notice, fare, styles } from '../ui/components';
import { SelectField } from '../ui/select-field';
import { pickMealPhoto } from './photo-file';
import type { MealPhoto } from './photo-file';
import { DiscoveryChip, FoodPhoto } from './discovery';
const storeDraft = (s: FoodStore | null, initialType: FoodSellerType = 'restaurant', areas: FoodArea[] = []) => ({ sellerType: s?.sellerType ?? initialType, deliveryAreaIds: s?.deliveryAreaIds ?? (s ? areas.map((a) => a.id) : ['wuse-ii']), deliveryEnabled: s?.deliveryEnabled !== false, pickupEnabled: s?.pickupEnabled ?? false, name: s?.name ?? '', cuisine: s?.cuisine ?? 'Nigerian', description: s?.description ?? '', address: s?.address ?? '', areaId: s?.areaId ?? 'wuse-ii', prepMinutes: String(s?.prepMinutes ?? 25), minimum: String((s?.minimumKobo ?? 0) / 100), fee: String((s?.deliveryFeeKobo ?? 150_000) / 100) });
const money = (value: string) => { if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter an amount with up to two decimal places.'); return Math.round(Number(value) * 100); };
export function StoreForm({ store, areas, controller: c, locked, initialType = 'restaurant' }: { initialType?: FoodSellerType; store: FoodStore | null; areas: FoodArea[]; controller: EatsController; locked: boolean }) {
  const [draft, setDraft] = useState(() => storeDraft(store, initialType, areas)), [version, setVersion] = useState(store?.version ?? null), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (!dirty) { setDraft(storeDraft(store, initialType, areas)); setVersion(store?.version ?? null); } }, [store?.version, dirty]);
  const change = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => { setDirty(true); setDraft((current) => ({ ...current, [key]: value })); };
  async function save() {
    setError('');
    try {
      const details = { sellerType: draft.sellerType, deliveryEnabled: draft.deliveryEnabled, deliveryAreaIds: draft.deliveryAreaIds, pickupEnabled: draft.pickupEnabled, name: draft.name, cuisine: draft.cuisine, description: draft.description, address: isPrivateKitchen(draft.sellerType) ? '' : draft.address, areaId: draft.areaId, prepMinutes: Number(draft.prepMinutes), minimumKobo: money(draft.minimum), deliveryFeeKobo: money(draft.fee) };
      if (store ? await c.storeAction('save', { expectedVersion: version, details }) : await c.createStore(details)) setDirty(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Review the store details.'); }
  }
  return <Card><Text style={styles.h2}>{store ? 'Store settings' : 'Create your store'}</Text><Notice message={error}/>
    {dirty && version !== (store?.version ?? null) && <Notice message="Store details changed while you were editing. Load saved details before saving again."/>}
    <SelectField label="What kind of kitchen?" value={draft.sellerType} onChange={(v) => change('sellerType', v as FoodSellerType)} options={[{ value: 'restaurant', label: 'Restaurant' }, { value: 'food_vendor', label: 'Food vendor' }, { value: 'home_kitchen', label: 'Home kitchen · sell your home cooking' }]} disabled={locked}/>
    <Field label="Kitchen name" value={draft.name} onChangeText={(v) => change('name', v)} maxLength={80} editable={!locked}/>
    <SelectField label="Cuisine" value={draft.cuisine} onChange={(v) => change('cuisine', v)} options={EATS_CUISINES.map((v) => ({ value: v, label: v }))} disabled={locked}/>
    <Field label="About your kitchen" value={draft.description} onChangeText={(v) => change('description', v)} maxLength={300} multiline editable={!locked}/>
    {!isPrivateKitchen(draft.sellerType) && <Field label="Restaurant address and landmark" value={draft.address} onChangeText={(v) => change('address', v)} maxLength={240} editable={!locked}/>}
    <SelectField label="Kitchen town or area" value={draft.areaId} onChange={(v) => change('areaId', v)} options={areas.map((a) => ({ value: a.id, label: a.name }))} disabled={locked}/>
    <Text style={styles.small}>{isPrivateKitchen(draft.sellerType) ? 'Food vendors and home kitchens show their name and town or area. Keep street addresses out of your public name, description and photos. When food is ready, share a private collection point with the assigned courier or pickup customer.' : 'Your restaurant address is shown with your menu so customers know where you are.'}</Text>
    <SelectField label="Offer delivery" value={draft.deliveryEnabled ? 'yes' : 'no'} onChange={(v) => change('deliveryEnabled', v === 'yes')} options={[{ value: 'yes', label: 'Yes · a courier collects the food' }, { value: 'no', label: 'No delivery' }]} disabled={locked}/>
    <SelectField label="Offer customer pickup" value={draft.pickupEnabled ? 'yes' : 'no'} onChange={(v) => change('pickupEnabled', v === 'yes')} options={[{ value: 'no', label: 'No customer pickup' }, { value: 'yes', label: 'Yes · share a collection point when ready' }]} disabled={locked}/>
    {draft.deliveryEnabled && <View style={styles.stack}><Text style={styles.label}>Towns or areas you deliver to</Text><View style={styles.row}>{areas.map((area) => <DiscoveryChip key={area.id} label={area.name} selected={draft.deliveryAreaIds.includes(area.id)} disabled={locked} onPress={() => change('deliveryAreaIds', draft.deliveryAreaIds.includes(area.id) ? draft.deliveryAreaIds.filter((id) => id !== area.id) : [...draft.deliveryAreaIds, area.id])}/>)}</View></View>}
    <Field label="Preparation time (10–120 minutes)" value={draft.prepMinutes} onChangeText={(v) => change('prepMinutes', v)} keyboardType="number-pad" editable={!locked}/>
    <Field label="Minimum order (₦)" value={draft.minimum} onChangeText={(v) => change('minimum', v)} keyboardType="decimal-pad" editable={!locked}/>
    <Field label="Delivery fee (₦)" value={draft.fee} onChangeText={(v) => change('fee', v)} keyboardType="decimal-pad" editable={!locked}/>
    <Text style={styles.small}>Use fictional details. An administrator must review the kitchen before it can open. Changing its type, name, cuisine, address or customer pickup setting requires a new review.</Text>
    <Button title="Save store" disabled={locked || (dirty && version !== (store?.version ?? null))} onPress={() => void save()}/>
    {store && <Button title="Load saved store details" secondary disabled={locked} onPress={() => { setDirty(false); setDraft(storeDraft(store, initialType, areas)); setVersion(store.version); }}/>}
  </Card>;
}
const itemDraft = (item: FoodMenuItem | null) => ({ stock: item?.portionsRemaining == null ? '' : String(item.portionsRemaining), allergens: item?.allergens ?? '', photoId: item?.photoId ?? null, name: item?.name ?? '', description: item?.description ?? '', category: item?.category ?? 'Meals', price: item ? String(item.priceKobo / 100) : '', available: item?.available ?? true });
export function MenuForm({ store, items, controller: c, locked }: { store: FoodStore; items: FoodMenuItem[]; controller: EatsController; locked: boolean }) {
  const [photo, setPhoto] = useState<MealPhoto | null>(null), [photoBusy, setPhotoBusy] = useState(false);
  locked = locked || photoBusy;
  const [editing, setEditing] = useState<FoodMenuItem | null>(null), [draft, setDraft] = useState(() => itemDraft(null)), [version, setVersion] = useState(store.version), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (!dirty) setVersion(store.version); }, [store.version, dirty]);
  const change = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => { if (!dirty) setVersion(store.version); setDirty(true); setDraft((current) => ({ ...current, [key]: value })); };
  const edit = (item: FoodMenuItem | null) => { setPhoto(null); setEditing(item); setDraft(itemDraft(item)); setVersion(store.version); setDirty(Boolean(item)); setError(''); };
  async function save() {
    setError('');
    try { if (await c.storeAction('menu', { expectedVersion: version, itemId: editing?.id ?? null, item: { name: draft.name, description: draft.description, category: draft.category, priceKobo: money(draft.price), available: draft.available, portionsRemaining: draft.stock.trim() === '' ? null : Number(draft.stock), allergens: draft.allergens, photoId: draft.photoId, ...(photo ? { photo } : {}) } })) edit(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Review the menu item.'); }
  }
  return <Card><Text style={styles.h2}>Your menu</Text>{items.map((item) => <View key={item.id} style={styles.stack}><Text style={styles.body}>{item.name} · {fare(item.priceKobo)} · {foodStock(item)}</Text><Button title={`Edit ${item.name}`} secondary disabled={locked} onPress={() => edit(item)}/></View>)}
    <Text style={styles.h2}>{editing ? `Edit ${editing.name}` : 'Add a menu item'}</Text><Notice message={error}/>
    {dirty && version !== store.version && <Notice message="The menu changed. Select the item again or choose New item before saving."/>}
    <Field label="Item name" value={draft.name} onChangeText={(v) => change('name', v)} maxLength={80} editable={!locked}/>
    <Field label="Ingredients and description" value={draft.description} onChangeText={(v) => change('description', v)} maxLength={300} multiline editable={!locked}/>
    <Field label="Menu section" value={draft.category} onChangeText={(v) => change('category', v)} maxLength={40} editable={!locked}/>
    <Field label="Price (₦)" value={draft.price} onChangeText={(v) => change('price', v)} keyboardType="decimal-pad" editable={!locked}/>
    <Field label="Allergen information" value={draft.allergens} onChangeText={(v) => change('allergens', v)} maxLength={300} multiline editable={!locked} placeholder="For example: contains milk; nuts handled in this kitchen"/>
    <Field label={store.sellerType === 'home_kitchen' ? 'Portions available in this batch (required)' : 'Portions available (blank for unlimited)'} value={draft.stock} onChangeText={(v) => change('stock', v)} keyboardType="number-pad" maxLength={4} editable={!locked}/>
    <Text style={styles.small}>Set 0–1,000 portions. Orders reserve portions automatically. Saving starts a new batch count; cancellations from an older batch will not increase it.</Text>
    {draft.photoId && !photo && <FoodPhoto id={draft.photoId} controller={c} label={draft.name} compact/>}
    <Text style={styles.body}>{photo ? 'New meal photo selected. Save to publish.' : draft.photoId ? 'A saved meal photo is attached.' : 'Add a photo of your food.'}</Text>
    <Text style={styles.small}>Your own dish, without people or private details. JPEG or PNG, up to 2 MiB. Location metadata is removed.</Text>
    <Button title="Choose meal photo" secondary busy={photoBusy} disabled={locked} onPress={() => { if (!dirty) setVersion(store.version); setDirty(true); setPhotoBusy(true); setError(''); void pickMealPhoto().then((value) => { if (value) { setPhoto(value); change('photoId', null); } }).catch((e) => setError(e.message)).finally(() => setPhotoBusy(false)); }}/>
    {(photo || draft.photoId) && <Button title="Remove photo" secondary disabled={locked} onPress={() => { setPhoto(null); change('photoId', null); }}/>}
    <SelectField label="Availability" value={draft.available ? 'yes' : 'no'} onChange={(v) => change('available', v === 'yes')} options={[{ value: 'yes', label: 'Available to order' }, { value: 'no', label: 'Sold out / hidden from customers' }]} disabled={locked}/>
    <Button title="Save menu item" disabled={locked || version !== store.version} onPress={() => void save()}/><Button title="New item" secondary disabled={locked} onPress={() => edit(null)}/>
  </Card>;
}
