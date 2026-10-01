import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type { EatsController, EatsState } from '../../../../packages/shared/src/eats-controller.mjs';
import type { FoodDeliveryAddress, FoodRecipient } from '../../../../packages/shared/src/eats.mjs';
import { normalizeFoodAddress, normalizeFoodRecipient } from '../../../../packages/shared/src/eats-delivery.mjs';
import { Button, Card, Field, Heading, Notice, styles } from '../ui/components';
import { Text } from '../ui/typography';
import { DiscoveryChip } from './discovery';
import { FoodLocationFields, foodLocationLabel } from './location-fields';
import { currentDeliveryPosition } from './delivery-location';
import { createDeliveryPositionRequest } from './delivery-position-request';
import type { DeliverySuggestion } from './delivery-position-request';
import { DeliveryMap } from './delivery-map';
import { deliveryAddressDraft, editDeliveryAddressDraft, confirmDeliveryAddressDraft, savedDeliveryAddressDraft, staleDeliveryAddressDraft } from './delivery-address-draft';

export function DeliverySetup({ state: s, controller: c, locked }: { state: EatsState; controller: EatsController; locked: boolean }) {
  const profileVersion = s.deliveryProfile?.version ?? null;
  const [draft, setDraft] = useState(() => deliveryAddressDraft(s.address, profileVersion));
  const address = draft.address, savedAddressChanged = staleDeliveryAddressDraft(draft, profileVersion);
  const [recipient, setRecipient] = useState<FoodRecipient>(() => ({ ...s.recipient }));
  const [suggestion, setSuggestion] = useState<DeliverySuggestion | null>(null), [attribution, setAttribution] = useState('');
  const [locating, setLocating] = useState(false), [error, setError] = useState(''), [locationKey, setLocationKey] = useState(0);
  const location = useMemo(() => createDeliveryPositionRequest({ currentPosition: currentDeliveryPosition, locate: (point) => c.locateDelivery(point),
    busy: setLocating, error: setError, result: (value) => { if (AppState.currentState === 'active') setSuggestion(value); } }), [c]);
  useEffect(() => () => location.dispose(), [location]);
  useEffect(() => { setDraft((current) => current.dirty ? current : { ...current, profileVersion }); }, [profileVersion]);
  useFocusEffect(useCallback(() => () => location.cancel(), [location]));
  useEffect(() => {
    const listener = AppState.addEventListener('change', (value) => { if (value === 'background') location.cancel(); });
    return () => listener.remove();
  }, [location]);
  function cancelSuggestion() { location.cancel(); setSuggestion(null); setError(''); }
  function editAddress(change: Partial<FoodDeliveryAddress>) {
    cancelSuggestion(); setAttribution(''); setDraft((previous) => editDeliveryAddressDraft(previous, change, profileVersion));
  }
  function chooseRecipient(kind: FoodRecipient['kind']) {
    if (locked || recipient.kind === kind) return;
    cancelSuggestion(); setAttribution(''); setDraft(deliveryAddressDraft({ line: '', areaId: '', point: null }, profileVersion)); setLocationKey((key) => key + 1);
    setRecipient({ kind, name: kind === 'self' ? s.user?.name ?? '' : '', phone: '' });
  }
  function chooseSaved(saved: FoodDeliveryAddress) {
    if (profileVersion === null) return;
    cancelSuggestion(); setAttribution(''); setDraft(savedDeliveryAddressDraft(saved, profileVersion)); setLocationKey((key) => key + 1);
  }
  function useSuggestion() {
    if (!suggestion) return;
    setDraft((current) => confirmDeliveryAddressDraft(current, { line: suggestion.line, areaId: suggestion.areaId ?? '', point: suggestion.point }, profileVersion));
    setAttribution(suggestion.attribution); setSuggestion(null); setLocationKey((key) => key + 1);
  }
  async function confirm() {
    cancelSuggestion();
    try { await c.confirmDelivery(normalizeFoodAddress(address), normalizeFoodRecipient(recipient, s.user?.name)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Review the recipient and delivery address.'); }
  }
  async function save(label: 'home' | 'work') {
    setError('');
    if (draft.profileVersion === null || draft.profileVersion !== profileVersion) { setError('Saved addresses changed. Select a current saved address, or discard these address edits before saving.'); return; }
    try {
      if (await c.saveDeliveryAddress(label, normalizeFoodAddress(address), draft.profileVersion)) {
        const profile = c.snapshot().deliveryProfile;
        setDraft((current) => current === draft ? deliveryAddressDraft(profile?.addresses[label] ?? address, profile?.version ?? null) : current);
      }
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Review this address before saving it.'); }
  }
  const disabled = locked || s.foodLoading, addressReady = address.line.trim().length >= 8 && Boolean(address.areaId);
  return <Card>
    <Heading title="Who is this food for?" subtitle="Choose the recipient before the delivery location."/>
    <View style={styles.row}><DiscoveryChip label="Myself" selected={recipient.kind === 'self'} disabled={disabled} onPress={() => chooseRecipient('self')}/><DiscoveryChip label="Someone else" selected={recipient.kind === 'other'} disabled={disabled} onPress={() => chooseRecipient('other')}/></View>
    {recipient.kind === 'other' ? <>
      <Field label="Recipient’s name" value={recipient.name} onChangeText={(name) => { cancelSuggestion(); setRecipient((current) => ({ ...current, name })); }} maxLength={100} editable={!disabled} autoComplete="off"/>
      <Field label="Recipient’s phone number" value={recipient.phone} onChangeText={(phone) => { cancelSuggestion(); setRecipient((current) => ({ ...current, phone })); }} maxLength={25} keyboardType="phone-pad" editable={!disabled} placeholder="+234… or an 11-digit Nigerian number" autoComplete="off"/>
      <Text style={styles.small}>Use their delivery address in Nigeria. You arrange the order and share the handover code privately; the app does not automatically contact them.</Text>
    </> : <>
      <Text style={styles.body}>For you · {s.user?.name ?? 'Your account'}</Text>
      <Field label="Delivery contact phone (optional)" value={recipient.phone} onChangeText={(phone) => { cancelSuggestion(); setRecipient((current) => ({ ...current, phone })); }} maxLength={25} keyboardType="phone-pad" editable={!disabled} autoComplete="tel"/>
    </>}
    <Text style={styles.h2}>Where should we deliver?</Text><Notice message={error}/>
    <Text style={styles.small}>Enter a Nigerian delivery address. Signup details and phone location are never treated as your home or work address.</Text>
    {recipient.kind === 'self' && <><Button title="Use my current location" secondary busy={locating} disabled={disabled} onPress={() => { editAddress({}); void location.current('self'); }}/><Text style={styles.small}>Use this only when the food should arrive where you are now. You will review the suggested location before using it.</Text></>}
    {!!s.deliveryProfileError && <><Notice message={s.deliveryProfileError}/><Button title="Retry saved addresses" secondary disabled={disabled || s.loading} onPress={() => void c.refresh()}/></>}
    <View style={styles.stack}>
      <Text style={styles.label}>MY SAVED ADDRESSES</Text>
      {(['home', 'work'] as const).map((label) => {
        const saved = s.deliveryProfile?.addresses[label], title = label === 'home' ? 'Home' : 'Work';
        return <View key={label} style={styles.stack}>{saved ? <>
          <Text style={styles.body}>{title} · {saved.line} · {foodLocationLabel(saved.areaId)}</Text>
          <Button title={`Use my saved ${title}`} secondary disabled={disabled} onPress={() => chooseSaved(saved)}/>
          <Button title={`Remove saved ${title}`} secondary disabled={disabled || !s.deliveryProfile} onPress={() => void c.saveDeliveryAddress(label, null)}/>
        </> : <Text style={styles.small}>{title} · {s.deliveryProfile ? 'Not saved' : 'Saved addresses unavailable. Manual entry still works.'}</Text>}</View>;
      })}
      <Text style={styles.small}>These addresses belong to your account. Selecting one does not change the recipient or save their name and phone.</Text>
      {savedAddressChanged && <><Notice message="Saved addresses changed while you were editing. Select a current Home or Work above, or discard your address edits before saving. You can still use the entered address for this order."/><Button title="Discard address edits" secondary disabled={disabled} onPress={() => { cancelSuggestion(); setAttribution(''); setDraft(deliveryAddressDraft({ line: '', areaId: '', point: null }, profileVersion)); setLocationKey((key) => key + 1); }}/></>}
    </View>
    <DeliveryMap point={suggestion?.point ?? address.point ?? null} disabled={disabled || locating} onSelect={(point) => { editAddress({}); void location.point(point); }}/>
    {locating && recipient.kind === 'other' && <Text style={styles.small} accessibilityLiveRegion="polite">Looking up the selected delivery point…</Text>}
    {suggestion && <View style={styles.stack}>
      <Text style={styles.h2}>Check this location</Text><Text style={styles.body}>{suggestion.line || 'No street address was found. Enter the building, street and landmark after selecting this point.'}</Text>
      {suggestion.areaId && <Text style={styles.body}>{foodLocationLabel(suggestion.areaId)}</Text>}
      {!!suggestion.attribution && <Text style={styles.small}>{suggestion.attribution}</Text>}
      <Text style={styles.small}>Check the map pin. A suggested address may need a building number or landmark.</Text>
      <Button title="Use this delivery location" disabled={disabled} onPress={useSuggestion}/><Button title="Discard location suggestion" secondary disabled={disabled} onPress={cancelSuggestion}/>
    </View>}
    <Field label="Delivery street, building and landmark" value={address.line} onChangeText={(line) => editAddress({ line })} placeholder="Street, building and a nearby landmark" maxLength={240} editable={!disabled}/>
    <FoodLocationFields key={locationKey} label="Delivery" value={address.areaId} onChange={(areaId) => editAddress({ areaId })} disabled={disabled}/>
    <Text style={styles.small}>{address.point ? 'A delivery pin is selected. Editing the street or town clears the pin so it cannot point to an old address.' : 'No map pin selected. A complete written address is enough to order.'}</Text>
    {!!attribution && <Text style={styles.small}>{attribution}</Text>}
    <Text style={styles.small}>Choose any Nigerian state or FCT and enter the town or local area. Available menus depend on kitchens serving that location.</Text>
    <View style={styles.row}>{(['home', 'work'] as const).map((label) => <Button key={label} title={`${s.deliveryProfile?.addresses[label] ? 'Replace' : 'Save'} my ${label === 'home' ? 'Home' : 'Work'} address`} secondary disabled={disabled || locating || !!suggestion || !addressReady || !s.deliveryProfile || draft.profileVersion === null || savedAddressChanged} onPress={() => void save(label)}/>)}</View>
    <Text style={styles.small}>Home and Work are saved only when you choose Save or Replace. Recipient details stay with the order.</Text>
    <Button title="Confirm delivery and find food" busy={s.foodLoading} disabled={disabled || locating || !!suggestion || !addressReady || recipient.kind === 'other' && (recipient.name.trim().length < 2 || !recipient.phone.trim())} onPress={() => void confirm()}/>
  </Card>;
}
