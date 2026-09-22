import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text } from '../ui/typography';
import { EATS_CUISINES } from '../../../../packages/shared/src/eats.mjs';
import type { FoodArea, FoodMenuItem, FoodStore } from '../../../../packages/shared/src/eats.mjs';
import type { EatsController } from '../../../../packages/shared/src/eats-controller.mjs';
import { Button, Card, Field, Notice, fare, styles } from '../ui/components';
import { SelectField } from '../ui/select-field';
const storeDraft = (s: FoodStore | null) => ({ name: s?.name ?? '', cuisine: s?.cuisine ?? 'Nigerian', description: s?.description ?? '', address: s?.address ?? '', areaId: s?.areaId ?? 'wuse-ii', prepMinutes: String(s?.prepMinutes ?? 25), minimum: String((s?.minimumKobo ?? 0) / 100), fee: String((s?.deliveryFeeKobo ?? 150_000) / 100) });
const money = (value: string) => { if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter an amount with up to two decimal places.'); return Math.round(Number(value) * 100); };
export function StoreForm({ store, areas, controller: c, locked }: { store: FoodStore | null; areas: FoodArea[]; controller: EatsController; locked: boolean }) {
  const [draft, setDraft] = useState(() => storeDraft(store)), [version, setVersion] = useState(store?.version ?? null), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (!dirty) { setDraft(storeDraft(store)); setVersion(store?.version ?? null); } }, [store?.version, dirty]);
  const change = (key: keyof typeof draft, value: string) => { setDirty(true); setDraft((current) => ({ ...current, [key]: value })); };
  async function save() {
    setError('');
    try {
      const details = { name: draft.name, cuisine: draft.cuisine, description: draft.description, address: draft.address, areaId: draft.areaId, prepMinutes: Number(draft.prepMinutes), minimumKobo: money(draft.minimum), deliveryFeeKobo: money(draft.fee) };
      if (store ? await c.storeAction('save', { expectedVersion: version, details }) : await c.createStore(details)) setDirty(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Review the store details.'); }
  }
  return <Card><Text style={styles.h2}>{store ? 'Store settings' : 'Create your store'}</Text><Notice message={error}/>
    {dirty && version !== (store?.version ?? null) && <Notice message="Store details changed while you were editing. Load saved details before saving again."/>}
    <Field label="Restaurant name" value={draft.name} onChangeText={(v) => change('name', v)} maxLength={80} editable={!locked}/>
    <SelectField label="Cuisine" value={draft.cuisine} onChange={(v) => change('cuisine', v)} options={EATS_CUISINES.map((v) => ({ value: v, label: v }))} disabled={locked}/>
    <Field label="About your kitchen" value={draft.description} onChangeText={(v) => change('description', v)} maxLength={300} multiline editable={!locked}/>
    <Field label="Pickup address and landmark" value={draft.address} onChangeText={(v) => change('address', v)} maxLength={240} editable={!locked}/>
    <SelectField label="Abuja pickup area" value={draft.areaId} onChange={(v) => change('areaId', v)} options={areas.map((a) => ({ value: a.id, label: a.name }))} disabled={locked}/>
    <Field label="Preparation time (10–120 minutes)" value={draft.prepMinutes} onChangeText={(v) => change('prepMinutes', v)} keyboardType="number-pad" editable={!locked}/>
    <Field label="Minimum order (₦)" value={draft.minimum} onChangeText={(v) => change('minimum', v)} keyboardType="decimal-pad" editable={!locked}/>
    <Field label="Delivery fee (₦)" value={draft.fee} onChangeText={(v) => change('fee', v)} keyboardType="decimal-pad" editable={!locked}/>
    <Text style={styles.small}>Use fictional details. An administrator must approve the restaurant before it can open. Changing its name, cuisine or pickup address requires a new review.</Text>
    <Button title="Save store" disabled={locked || (dirty && version !== (store?.version ?? null))} onPress={() => void save()}/>
    {store && <Button title="Load saved store details" secondary disabled={locked} onPress={() => { setDirty(false); setDraft(storeDraft(store)); setVersion(store.version); }}/>}
  </Card>;
}
const itemDraft = (item: FoodMenuItem | null) => ({ name: item?.name ?? '', description: item?.description ?? '', category: item?.category ?? 'Meals', price: item ? String(item.priceKobo / 100) : '', available: item?.available ?? true });
export function MenuForm({ store, items, controller: c, locked }: { store: FoodStore; items: FoodMenuItem[]; controller: EatsController; locked: boolean }) {
  const [editing, setEditing] = useState<FoodMenuItem | null>(null), [draft, setDraft] = useState(() => itemDraft(null)), [version, setVersion] = useState(store.version), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (!dirty) setVersion(store.version); }, [store.version, dirty]);
  const change = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => { if (!dirty) setVersion(store.version); setDirty(true); setDraft((current) => ({ ...current, [key]: value })); };
  const edit = (item: FoodMenuItem | null) => { setEditing(item); setDraft(itemDraft(item)); setVersion(store.version); setDirty(Boolean(item)); setError(''); };
  async function save() {
    setError('');
    try { if (await c.storeAction('menu', { expectedVersion: version, itemId: editing?.id ?? null, item: { name: draft.name, description: draft.description, category: draft.category, priceKobo: money(draft.price), available: draft.available } })) edit(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Review the menu item.'); }
  }
  return <Card><Text style={styles.h2}>Your menu</Text>{items.map((item) => <View key={item.id} style={styles.stack}><Text style={styles.body}>{item.name} · {fare(item.priceKobo)} · {item.available ? 'Available' : 'Sold out'}</Text><Button title={`Edit ${item.name}`} secondary disabled={locked} onPress={() => edit(item)}/></View>)}
    <Text style={styles.h2}>{editing ? `Edit ${editing.name}` : 'Add a menu item'}</Text><Notice message={error}/>
    {dirty && version !== store.version && <Notice message="The menu changed. Select the item again or choose New item before saving."/>}
    <Field label="Item name" value={draft.name} onChangeText={(v) => change('name', v)} maxLength={80} editable={!locked}/>
    <Field label="Ingredients and description" value={draft.description} onChangeText={(v) => change('description', v)} maxLength={300} multiline editable={!locked}/>
    <Field label="Menu section" value={draft.category} onChangeText={(v) => change('category', v)} maxLength={40} editable={!locked}/>
    <Field label="Price (₦)" value={draft.price} onChangeText={(v) => change('price', v)} keyboardType="decimal-pad" editable={!locked}/>
    <SelectField label="Availability" value={draft.available ? 'yes' : 'no'} onChange={(v) => change('available', v === 'yes')} options={[{ value: 'yes', label: 'Available to order' }, { value: 'no', label: 'Sold out / hidden from customers' }]} disabled={locked}/>
    <Button title="Save menu item" disabled={locked || version !== store.version} onPress={() => void save()}/><Button title="New item" secondary disabled={locked} onPress={() => edit(null)}/>
  </Card>;
}
