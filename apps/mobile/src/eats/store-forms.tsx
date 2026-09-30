import { useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { Text } from '../ui/typography';
import { EATS_CUISINES, foodStock, isPrivateKitchen } from '../../../../packages/shared/src/eats.mjs';
import type { FoodMenuItem, FoodStore, FoodSellerType } from '../../../../packages/shared/src/eats.mjs';
import type { EatsController } from '../../../../packages/shared/src/eats-controller.mjs';
import { Button, Card, Field, Notice, fare, styles } from '../ui/components';
import { SelectField } from '../ui/select-field';
import { chooseDishPhoto } from './photo';
import type { MealPhoto } from './photo-file';
import { FoodPhoto } from './discovery';
import { FoodPhotoGuidance, FoodPhotoReview, SelectedFoodPhoto } from './photo-fields';
import { FoodLocationFields, foodLocationLabel } from './location-fields';
import { changeStoreLocation, storeDraft } from './store-draft';
import { currentPosition } from '../work/location';
import { insideNigeria } from '../../../../packages/shared/src/locations.mjs';
import { LEGACY_FOOD_AREAS } from '../../../../packages/shared/src/nigeria-areas.mjs';
const money = (value: string) => { if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter an amount with up to two decimal places.'); return Math.round(Number(value) * 100); };
export function StoreForm({ store, controller: c, locked, initialType = 'restaurant' }: { initialType?: FoodSellerType; store: FoodStore | null; controller: EatsController; locked: boolean }) {
  const [draft, setDraft] = useState(() => storeDraft(store, initialType)), [version, setVersion] = useState(store?.version ?? null), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  const [coverageArea, setCoverageArea] = useState(''), [locating, setLocating] = useState(false), [locationFormKey, setLocationFormKey] = useState(0);
  const capture = useRef(0);
  const needsPickupPoint = draft.deliveryEnabled && !LEGACY_FOOD_AREAS.some((area) => area.id === draft.areaId);
  const pointSaved = Boolean(draft.dispatchPoint && store?.dispatchPoint && draft.dispatchPoint.lat === store.dispatchPoint.lat && draft.dispatchPoint.lng === store.dispatchPoint.lng);
  locked = locked || locating;
  useEffect(() => { if (!dirty) { setDraft(storeDraft(store, initialType)); setVersion(store?.version ?? null); } }, [store?.version, dirty]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'background') { capture.current++; setLocating(false); } });
    return () => { capture.current++; subscription.remove(); };
  }, []);
  const change = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => { setDirty(true); setDraft((current) => ({ ...current, [key]: value })); };
  async function locateKitchen() {
    const operation = ++capture.current; setLocating(true); setError('');
    try {
      const point = await currentPosition(true, 'kitchen');
      if (capture.current !== operation || AppState.currentState !== 'active') return;
      if (!insideNigeria(point) || Math.abs(Date.now() - point.capturedAt) > 30_000) throw new Error('A fresh location in Nigeria is needed. Try again at your kitchen.');
      change('dispatchPoint', { lat: point.lat, lng: point.lng });
    } catch (e) { if (capture.current === operation) setError(e instanceof Error ? e.message : 'Could not get your kitchen location.'); }
    finally { if (capture.current === operation) setLocating(false); }
  }
  async function save() {
    setError('');
    try {
      const details = { sellerType: draft.sellerType, deliveryEnabled: draft.deliveryEnabled, deliveryAreaIds: draft.deliveryAreaIds, dispatchPoint: draft.dispatchPoint, pickupEnabled: draft.pickupEnabled, name: draft.name, cuisine: draft.cuisine, description: draft.description, address: isPrivateKitchen(draft.sellerType) ? '' : draft.address, areaId: draft.areaId, prepMinutes: Number(draft.prepMinutes), minimumKobo: money(draft.minimum), deliveryFeeKobo: money(draft.fee) };
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
    <FoodLocationFields key={locationFormKey} label="Kitchen" value={draft.areaId} onChange={(v) => { setDirty(true); setDraft((current) => changeStoreLocation(current, v)); }} disabled={locked}/>
    <Text style={styles.small}>{isPrivateKitchen(draft.sellerType) ? 'Food vendors and home kitchens show their name and town or area. Keep street addresses out of your public name, description and photos. When food is ready, share a private collection point with the assigned courier or pickup customer.' : 'Your restaurant address is shown with your menu so customers know where you are.'}</Text>
    <SelectField label="Offer delivery" value={draft.deliveryEnabled ? 'yes' : 'no'} onChange={(v) => change('deliveryEnabled', v === 'yes')} options={[{ value: 'yes', label: 'Yes · a courier collects the food' }, { value: 'no', label: 'No delivery' }]} disabled={locked}/>
    <SelectField label="Offer customer pickup" value={draft.pickupEnabled ? 'yes' : 'no'} onChange={(v) => change('pickupEnabled', v === 'yes')} options={[{ value: 'no', label: 'No customer pickup' }, { value: 'yes', label: 'Yes · share a collection point when ready' }]} disabled={locked}/>
    {draft.deliveryEnabled && <View style={styles.stack}><Text style={styles.label}>Towns or areas you deliver to</Text>
      <Text style={styles.small}>Add the local towns or areas you can serve. Customers must select a matching town and state. Choosing a state does not enable delivery across the state.</Text>
      {draft.deliveryAreaIds.map((id) => <Button key={id} title={`Remove ${foodLocationLabel(id)}`} secondary disabled={locked} onPress={() => change('deliveryAreaIds', draft.deliveryAreaIds.filter((value) => value !== id))}/>)}
      <FoodLocationFields label="Add delivery coverage" value={coverageArea} onChange={setCoverageArea} disabled={locked}/>
      <Button title="Add delivery town" secondary disabled={locked || !coverageArea || draft.deliveryAreaIds.includes(coverageArea) || draft.deliveryAreaIds.length >= 50} onPress={() => change('deliveryAreaIds', [...draft.deliveryAreaIds, coverageArea])}/>
      <Text style={styles.label}>PRIVATE COURIER PICKUP LOCATION</Text>
      <Text style={styles.small}>At your kitchen, add a location to find couriers within 10 km. This point stays off your public profile. You still share collection instructions privately when food is ready.</Text>
      <Text style={styles.body}>{draft.dispatchPoint ? pointSaved ? 'Your private pickup location is saved.' : 'A private pickup location is selected. Save the store to submit it for review.' : needsPickupPoint ? 'You can save a draft now. Add a private pickup location before opening for delivery and accepting delivery orders, or choose customer pickup only.' : 'No private pickup location. GPS couriers cannot find this kitchen for delivery yet.'}</Text>
      <Button title="Use my current location" secondary busy={locating} disabled={locked || !draft.areaId} onPress={() => void locateKitchen()}/>
      {draft.dispatchPoint && <Button title="Clear private pickup location" secondary disabled={locked} onPress={() => change('dispatchPoint', null)}/>}
    </View>}
    <Field label="Preparation time (10–120 minutes)" value={draft.prepMinutes} onChangeText={(v) => change('prepMinutes', v)} keyboardType="number-pad" editable={!locked}/>
    <Field label="Minimum order (₦)" value={draft.minimum} onChangeText={(v) => change('minimum', v)} keyboardType="decimal-pad" editable={!locked}/>
    <Field label="Delivery fee (₦)" value={draft.fee} onChangeText={(v) => change('fee', v)} keyboardType="decimal-pad" editable={!locked}/>
    <Text style={styles.small}>Development preview. An administrator must review the kitchen before it can open. Changes to its identity or pickup location require a new review.</Text>
    <Button title="Save store" disabled={locked || !draft.areaId || draft.deliveryEnabled && !draft.deliveryAreaIds.length || (dirty && version !== (store?.version ?? null))} onPress={() => void save()}/>
    {store && <Button title="Load saved store details" secondary disabled={locked} onPress={() => { setDirty(false); setDraft(storeDraft(store, initialType)); setVersion(store.version); setLocationFormKey((value) => value + 1); }}/>}
  </Card>;
}
const itemDraft = (item: FoodMenuItem | null) => ({ stock: item?.portionsRemaining == null ? '' : String(item.portionsRemaining), allergens: item?.allergens ?? '', photoId: item?.photoId ?? null, name: item?.name ?? '', description: item?.description ?? '', category: item?.category ?? 'Meals', price: item ? String(item.priceKobo / 100) : '', available: item?.available ?? true });
export function MenuForm({ store, items, controller: c, locked }: { store: FoodStore; items: FoodMenuItem[]; controller: EatsController; locked: boolean }) {
  const [photo, setPhoto] = useState<MealPhoto | null>(null), [photoBusy, setPhotoBusy] = useState(false);
  const photoOperation = useRef(0);
  useEffect(() => () => { photoOperation.current++; }, []);
  locked = locked || photoBusy;
  const [editing, setEditing] = useState<FoodMenuItem | null>(null), [draft, setDraft] = useState(() => itemDraft(null)), [version, setVersion] = useState(store.version), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  const savedPhoto = editing ? items.find((item) => item.id === editing.id && item.photoId === draft.photoId) : null;
  useEffect(() => { if (!dirty) setVersion(store.version); }, [store.version, dirty]);
  const change = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => { if (!dirty) setVersion(store.version); setDirty(true); setDraft((current) => ({ ...current, [key]: value })); };
  const edit = (item: FoodMenuItem | null) => { setPhoto(null); setEditing(item); setDraft(itemDraft(item)); setVersion(store.version); setDirty(Boolean(item)); setError(''); };
  async function save() {
    setError('');
    try { if (await c.storeAction('menu', { expectedVersion: version, itemId: editing?.id ?? null, item: { name: draft.name, description: draft.description, category: draft.category, priceKobo: money(draft.price), available: draft.available, portionsRemaining: draft.stock.trim() === '' ? null : Number(draft.stock), allergens: draft.allergens, photoId: draft.photoId, ...(photo ? { photo } : {}) } })) edit(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Review the menu item.'); }
  }
  async function selectPhoto(camera: boolean) {
    if (locked) return;
    const operation = ++photoOperation.current;
    setPhotoBusy(true); setError('');
    try { const value = await chooseDishPhoto(camera); if (photoOperation.current === operation && value) { setPhoto(value); change('photoId', null); } }
    catch (e) { if (photoOperation.current === operation) setError(e instanceof Error ? e.message : 'Could not read that photo.'); }
    finally { if (photoOperation.current === operation) setPhotoBusy(false); }
  }
  return <Card><Text style={styles.h2}>Your menu</Text>{items.map((item) => <View key={item.id} style={styles.stack}><Text style={styles.body}>{item.name} · {fare(item.priceKobo)} · {foodStock(item)}</Text>{item.photoId && <FoodPhotoReview status={item.photoStatus} note={item.photoReviewNote}/>}<Button title={`Edit ${item.name}`} secondary disabled={locked} onPress={() => edit(item)}/></View>)}
    <Text style={styles.h2}>{editing ? `Edit ${editing.name}` : 'Add a menu item'}</Text><Notice message={error}/>
    {dirty && version !== store.version && <Notice message="The menu changed. Select the item again or choose New item before saving."/>}
    <Field label="Item name" value={draft.name} onChangeText={(v) => change('name', v)} maxLength={80} editable={!locked}/>
    <Field label="Ingredients and description" value={draft.description} onChangeText={(v) => change('description', v)} maxLength={300} multiline editable={!locked}/>
    <Field label="Menu section" value={draft.category} onChangeText={(v) => change('category', v)} maxLength={40} editable={!locked}/>
    <Field label="Price (₦)" value={draft.price} onChangeText={(v) => change('price', v)} keyboardType="decimal-pad" editable={!locked}/>
    <Field label="Allergen information" value={draft.allergens} onChangeText={(v) => change('allergens', v)} maxLength={300} multiline editable={!locked} placeholder="For example: contains milk; nuts handled in this kitchen"/>
    <Field label={store.sellerType === 'home_kitchen' ? 'Portions available in this batch (required)' : 'Portions available (blank for unlimited)'} value={draft.stock} onChangeText={(v) => change('stock', v)} keyboardType="number-pad" maxLength={4} editable={!locked}/>
    <Text style={styles.small}>Set 0–1,000 portions. Orders reserve portions automatically. Saving starts a new batch count; cancellations from an older batch will not increase it.</Text>
    {photo ? <SelectedFoodPhoto photo={photo} label={draft.name || 'Meal'}/> : savedPhoto?.photoId && <><FoodPhoto id={savedPhoto.photoId} revision={savedPhoto.photoVersion} controller={c} label={draft.name} compact/><FoodPhotoReview status={savedPhoto.photoStatus} note={savedPhoto.photoReviewNote}/></>}
    <Text style={styles.body}>{photo ? 'New meal photo selected. Save the menu item to submit the photo for review.' : savedPhoto?.photoId ? 'A saved meal photo is attached.' : 'Photo optional · customers see “Photo coming soon” without an approved image.'}</Text>
    <FoodPhotoGuidance/>
    <Button title="Choose meal photo" secondary busy={photoBusy} disabled={locked} onPress={() => void selectPhoto(false)}/>
    <Button title="Take a dish photo" secondary disabled={locked} onPress={() => void selectPhoto(true)}/>
    {(photo || draft.photoId) && <Button title="Remove photo" secondary disabled={locked} onPress={() => { setPhoto(null); change('photoId', null); }}/>}
    <SelectField label="Availability" value={draft.available ? 'yes' : 'no'} onChange={(v) => change('available', v === 'yes')} options={[{ value: 'yes', label: 'Available to order' }, { value: 'no', label: 'Sold out / hidden from customers' }]} disabled={locked}/>
    <Button title="Save menu item" disabled={locked || version !== store.version} onPress={() => void save()}/><Button title="New item" secondary disabled={locked} onPress={() => edit(null)}/>
  </Card>;
}
