import { $, element } from '../dashboard/dom.mjs';
import { createGeolocation } from '../dashboard/geolocation.mjs';
import { createMapView } from '../dashboard/map-view.mjs';
import { insideNigeria } from '/shared/locations.mjs';
import { createFoodLocationFields, foodAreaLabel } from './location-fields.mjs';

const field = (id) => $('food-meal-' + id);
export const OUTSIDE_FOOD_DELIVERY_MESSAGE = 'You appear to be outside Nigeria. You can still order for someone in Nigeria: choose Someone else and enter their Nigerian delivery address.';
export function checkedFoodLocation(fix, now = Date.now()) {
  const point = { lat: fix?.coords?.latitude, lng: fix?.coords?.longitude };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) throw new Error('Your location could not be read. Enter the delivery address manually.');
  if (!insideNigeria(point)) throw new Error(OUTSIDE_FOOD_DELIVERY_MESSAGE);
  if (!Number.isFinite(fix.coords.accuracy) || fix.coords.accuracy <= 0 || fix.coords.accuracy > 200) throw new Error('Your location is not accurate enough. Try again outdoors or enter the delivery address manually.');
  if (fix.timestamp != null && (!Number.isFinite(fix.timestamp) || now - fix.timestamp > 30_000 || fix.timestamp - now > 5_000)) throw new Error('That location is out of date. Try again or enter the delivery address manually.');
  return point;
}

function locationError(error) {
  if (error?.code === 1) return 'Location access is blocked. Allow this site in browser settings, or enter your delivery address manually.';
  if (error?.code === 2) return 'Your device could not find your location. Enter your delivery address manually or try again.';
  if (error?.code === 3) return 'Getting your location took too long. Enter your delivery address manually or try again.';
  return error?.message || 'Could not get your location. Enter your delivery address manually.';
}

/** Recipient and address remain an in-memory draft until explicitly confirmed or saved. */
export function createDeliveryForm(controller, { geolocation = createGeolocation(), createMap = createMapView, onConfirmed = () => {} } = {}) {
  let state, owner, operation = 0, recipientKind = 'self', point = null, dirty = false, draftProfileVersion = null, stateKey = '', locating = false, mapEnabled = false, settings = null, pinKey = '', savedKey = '', error = '', notice = '', attribution = '';
  const locked = () => Boolean(state?.busy || state?.uncertain || state?.stale || state?.foodLoading);
  const current = (epoch, account) => epoch === operation && account === owner && state?.screen === 'browse' && !state.deliveryConfirmed;
  const cancelLocation = () => { operation++; locating = false; };
  const markDirty = () => { if (!dirty) draftProfileVersion = state?.deliveryProfile?.version ?? null; dirty = true; };
  const savedDraftStale = () => dirty && state?.deliveryProfile && draftProfileVersion !== state.deliveryProfile.version;
  const location = createFoodLocationFields({ state: field('state'), town: field('town'), onChange: () => editAddress() });
  const map = createMap(field('map'), { onPick: (selected) => {
    if (locked()) return; cancelLocation();
    if (!insideNigeria(selected)) { error = 'Choose a delivery pin inside Nigeria, or enter the address without a pin.'; renderDraft(); return; }
    point = { lat: selected.lat, lng: selected.lng }; markDirty(); error = ''; notice = 'Pin selected. Check the delivery address and landmark before confirming.'; attribution = ''; renderDraft();
  } });
  function draftAddress() { return { line: field('address').value.trim(), areaId: location.value(), ...(point ? { point: { ...point } } : {}) }; }
  function draftRecipient() { return recipientKind === 'other' ? { kind: 'other', name: field('recipient-name').value.trim(), phone: field('recipient-phone').value.trim() } : { kind: 'self', name: state?.user?.name ?? '', phone: '' }; }
  function editAddress() {
    if (locked()) return; cancelLocation(); markDirty(); point = null; attribution = ''; notice = 'Address changed. Any previous pin was cleared; you can add a new pin if needed.'; error = ''; renderDraft();
  }
  function useAddress(address, description) {
    cancelLocation(); dirty = true; draftProfileVersion = state?.deliveryProfile?.version ?? null; point = address.point ? { ...address.point } : null; field('address').value = address.line; location.set(address.areaId); error = ''; attribution = ''; notice = description; renderDraft();
  }
  function renderDraft() {
    const other = recipientKind === 'other', disabled = locked();
    for (const kind of ['self', 'other']) { field('recipient-' + kind).setAttribute('aria-pressed', String(recipientKind === kind)); field('recipient-' + kind).disabled = disabled; }
    field('recipient-fields').hidden = !other; field('recipient-name').required = field('recipient-phone').required = other;
    field('self-destination-options').hidden = field('self-save-options').hidden = other;
    field('location-fields').disabled = disabled;
    field('current-location').disabled = disabled || locating; field('current-location').textContent = locating ? 'Finding your location…' : 'Use my current location';
    field('location-status').textContent = locating ? 'Waiting for your location. If you type an address instead, any late location result will be ignored.' : notice;
    field('location-error').textContent = error; field('location-attribution').textContent = attribution;
    field('pin-summary').textContent = point ? `Delivery pin: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}. Confirm this matches the address.` : 'No delivery pin selected. You can still use the written address.';
    const nextPinKey = JSON.stringify(point);
    if (pinKey !== nextPinKey) { pinKey = nextPinKey; field('pin-latitude').value = point ? String(point.lat) : ''; field('pin-longitude').value = point ? String(point.lng) : ''; }
    field('pin-clear').disabled = disabled || !point; field('pin-apply').disabled = disabled;
    field('map-toggle').disabled = disabled; field('map-toggle').textContent = mapEnabled ? 'Hide delivery map' : 'Show optional delivery map';
    field('map-wrap').hidden = !mapEnabled; field('map-attribution').textContent = settings?.attribution ?? '';
    map.render({ enabled: mapEnabled && Boolean(settings?.tiles) && state?.screen === 'browse' && !state.deliveryConfirmed, tiles: settings?.tiles,
      destination: point ? { ...point, name: 'Delivery address' } : null, focusKey: JSON.stringify([owner, point]) });
    const name = other ? field('recipient-name').value.trim() || 'Enter recipient name' : state?.user?.name || 'Myself';
    const address = field('address').value.trim(), areaId = location.value();
    field('confirm-summary').textContent = `${other ? 'For ' : ''}${name}${other && field('recipient-phone').value.trim() ? ' · ' + field('recipient-phone').value.trim() : ''} · ${address || 'Enter address and landmark'}${areaId ? ' · ' + foodAreaLabel(areaId) : ''}${point ? ' · Pin selected' : ''}`;
    field('confirm-location').disabled = disabled || locating;
    field('saved-status').textContent = state?.deliveryProfileError || (!state?.deliveryProfile ? 'Saved addresses are unavailable. You can still enter the delivery address manually and refresh to retry.' : 'Home and Work are private to your signed-in account. Saving is always your choice.');
    const nextSavedKey = JSON.stringify([owner, other, state?.deliveryProfile, disabled, locating]);
    if (savedKey !== nextSavedKey) {
      savedKey = nextSavedKey;
      field('saved-addresses').replaceChildren();
      if (!other) for (const label of ['home', 'work']) {
        const profileVersion = state?.deliveryProfile?.version, saved = state?.deliveryProfile?.addresses?.[label], title = label === 'home' ? 'Home' : 'Work', row = element('div', undefined, 'food-saved-address');
        row.append(element('strong', title), element('p', saved ? `${saved.line} · ${foodAreaLabel(saved.areaId)}` : `${title} is not saved.`, 'small-note'));
        const actions = element('div', undefined, 'food-actions');
        if (saved) for (const [caption, callback] of [[`Use ${title}`, () => useAddress(saved, `${title} selected. Check the details, then confirm delivery.`)], [`Edit ${title}`, () => { useAddress(saved, `Editing ${title}. Update the address and choose Save as ${title}.`); field('address').focus(); }], [`Remove ${title}`, async () => { if (await controller.saveDeliveryAddress(label, null, profileVersion)) { notice = `${title} removed from your account.`; renderDraft(); } }]]) {
          const button = element('button', caption, 'button button-outline'); button.type = 'button'; button.disabled = disabled || locating;
          button.addEventListener('click', () => { if (!locked()) void callback(); }); actions.append(button);
        }
        row.append(actions); field('saved-addresses').append(row);
      }
    }
    field('saved-stale').hidden = other || !savedDraftStale(); field('discard-address').disabled = disabled || locating;
    for (const label of ['home', 'work']) field('save-' + label).disabled = disabled || locating || !state?.deliveryProfile || savedDraftStale();

  }
  for (const kind of ['self', 'other']) field('recipient-' + kind).addEventListener('click', () => {
    if (locked() || recipientKind === kind) return;
    cancelLocation(); recipientKind = kind; dirty = true; draftProfileVersion = state?.deliveryProfile?.version ?? null; point = null; field('address').value = ''; location.set(''); field('recipient-name').value = field('recipient-phone').value = ''; attribution = ''; error = '';
    notice = kind === 'other' ? 'Enter the recipient’s Nigerian delivery address. Your device location is not used for their order.' : 'Choose your current location, Home, Work or type an address.'; renderDraft();
  });
  field('address').addEventListener('input', editAddress);
  for (const id of ['recipient-name', 'recipient-phone']) field(id).addEventListener('input', () => { if (locked()) return; cancelLocation(); markDirty(); error = ''; renderDraft(); });
  field('current-location').addEventListener('click', async () => {
    if (locked() || locating || recipientKind !== 'self') return;
    if (!geolocation.supported()) { error = 'Current location needs a supported browser on HTTPS or localhost. You can enter your delivery address manually.'; renderDraft(); return; }
    const epoch = ++operation, account = owner; locating = true; error = ''; notice = ''; renderDraft();
    let timer;
    try {
      const fix = await Promise.race([geolocation.locate(), new Promise((_, reject) => { timer = setTimeout(() => reject({ code: 3 }), 15_000); })]);
      if (!current(epoch, account)) return;
      const selected = checkedFoodLocation(fix);
      // A fresh device fix replaces the previous destination. A missing lookup
      // must never attach its coordinates to an older typed or saved address.
      point = selected; field('address').value = ''; location.set(''); attribution = ''; markDirty(); renderDraft();
      const result = await controller.locateDelivery(selected);
      if (!current(epoch, account)) return;
      point = selected; markDirty();
      if (result) { if (result.line) field('address').value = result.line; if (result.areaId) location.set(result.areaId); attribution = result.attribution ?? ''; }
      notice = 'Current location selected. Check or complete the address, landmark, state and town, then confirm. Location is not saved unless you choose Save as Home or Work.';
    } catch (cause) { if (current(epoch, account)) error = locationError(cause); }
    finally { clearTimeout(timer); if (current(epoch, account)) { locating = false; renderDraft(); } }
  });
  field('pin-apply').addEventListener('click', () => {
    if (locked()) return;
    const lat = field('pin-latitude').value.trim(), lng = field('pin-longitude').value.trim(), selected = { lat: Number(lat), lng: Number(lng) };
    if (!lat || !lng || !insideNigeria(selected)) { error = 'Enter latitude and longitude for a delivery point inside Nigeria, or continue without a pin.'; field('location-error').textContent = error; return; }
    cancelLocation(); point = selected; markDirty(); error = ''; notice = 'Pin selected. Confirm it matches your written address and landmark.'; renderDraft();
  });
  field('pin-clear').addEventListener('click', () => { if (locked()) return; cancelLocation(); point = null; markDirty(); attribution = ''; notice = 'Delivery pin cleared. The written address will be used.'; renderDraft(); });
  field('map-toggle').addEventListener('click', () => {
    if (locked()) return;
    settings = state.deliverySettings;
    if (mapEnabled) mapEnabled = false;
    else if (!settings?.tiles) error = 'The street map is unavailable. Enter the address or an optional coordinate pin.';
    else { mapEnabled = true; error = ''; }
    renderDraft();
  });
  for (const label of ['home', 'work']) field('save-' + label).addEventListener('click', async () => {
    if (locked() || locating || recipientKind !== 'self' || !state.deliveryProfile || savedDraftStale()) return;
    const address = draftAddress();
    if (address.line.length < 8 || !address.areaId) { error = 'Enter the full address and landmark, then choose the state and town before saving.'; renderDraft(); return; }
    const account = owner, expectedVersion = dirty ? draftProfileVersion : state.deliveryProfile.version;
    if (await controller.saveDeliveryAddress(label, address, expectedVersion) && account === owner) { if (state.deliveryProfile?.version === expectedVersion + 1) draftProfileVersion = state.deliveryProfile.version; notice = `${label === 'home' ? 'Home' : 'Work'} saved to your account. Confirm below to use it for this order.`; renderDraft(); }
  });
  field('discard-address').addEventListener('click', () => {
    if (locked()) return; cancelLocation(); dirty = false; draftProfileVersion = state.deliveryProfile?.version ?? null; point = null; field('address').value = ''; location.set(''); attribution = error = ''; notice = 'Address draft discarded. Review your saved addresses and choose Home or Work, or type a new address.'; renderDraft();
  });
  field('location-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (locked() || locating) return;
    if (await controller.confirmDelivery(draftAddress(), draftRecipient())) { dirty = false; onConfirmed(); }
  });
  field('change').addEventListener('click', () => { if (state?.busy || state?.uncertain) return; cancelLocation(); markDirty(); controller.editDelivery(); field('address').focus(); });
  return { render(next) {
    state = next;
    const accountKey = state.user ? `${state.user.id}:${state.user.role}` : null;
    if (owner !== accountKey) {
      owner = accountKey; cancelLocation(); recipientKind = 'self'; point = null; dirty = false; draftProfileVersion = null; stateKey = ''; mapEnabled = false; settings = null; pinKey = savedKey = ''; error = notice = attribution = '';
      for (const id of ['address', 'recipient-name', 'recipient-phone', 'pin-latitude', 'pin-longitude']) field(id).value = '';
      location.set(''); map.reset();
    }
    if (state.screen !== 'browse' || state.deliveryConfirmed) { cancelLocation(); mapEnabled = false; }
    const key = JSON.stringify([state.address, state.recipient]);
    if (key !== stateKey && (!dirty || state.deliveryConfirmed)) {
      stateKey = key; draftProfileVersion = state.deliveryProfile?.version ?? null; field('address').value = state.address.line; location.set(state.address.areaId); point = state.address.point ? { ...state.address.point } : null;
      recipientKind = state.recipient?.kind ?? 'self'; field('recipient-name').value = state.recipient?.kind === 'other' ? state.recipient.name : ''; field('recipient-phone').value = state.recipient?.kind === 'other' ? state.recipient.phone : '';
    }
    field('location-form').hidden = state.deliveryConfirmed;
    field('destination-text').textContent = `${state.recipient?.kind === 'other' ? `${state.recipient.name} · ` : ''}${state.address.line} · ${foodAreaLabel(state.address.areaId)}${state.address.point ? ' · Delivery pin selected' : ''}`;
    field('change').disabled = Boolean(state.busy || state.uncertain);
    renderDraft();
  } };
}
