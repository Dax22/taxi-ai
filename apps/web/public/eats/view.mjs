import { createFoodLocationFields, foodAreaLabel } from './location-fields.mjs';
import { NIGERIAN_STATES, foodAreaId, resolveFoodArea } from '/shared/nigeria-areas.mjs';
import { insideNigeria } from '/shared/locations.mjs';
import { createGeolocation } from '../dashboard/geolocation.mjs';
import { createMealView } from './meal-view.mjs';
import { $, element } from '../dashboard/dom.mjs';
import { EATS_CUISINES, EATS_SYMBOLS, EATS_STATUS, EATS_SELLERS, foodAvailable, foodStock, discoverKitchens, isPrivateKitchen } from '/shared/eats.mjs';
import { formatNaira } from '/shared/demo-booking.mjs';
const actionLabels = { accept: 'Accept order', reject: 'Decline order', prepare: 'Start preparing', ready: 'Ready for pickup', claim: 'Accept delivery', pickup: 'Confirm food collected', arrive: 'I’m at the delivery address', deliver: 'Confirm delivered', complete_pickup: 'Confirm customer collected', cancel: 'Cancel order' };
const field = (id) => $('food-' + id);
const text = (tag, value, className) => element(tag, value, className);
const money = (value) => { const n = Number(value); if (!Number.isFinite(n) || n < 0 || !/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter an amount with up to two decimal places.'); return Math.round(n * 100); };
export function createEatsView(controller, { geolocation = createGeolocation(), sellerPage = () => globalThis.location?.pathname === '/eats/sell', navigate = (screen) => controller.navigate(screen) } = {}) {
  let state, ownerId = null, storeDirty = false, storeVersion = undefined, menuId = null, menuVersion = null, menuDirty = false, photo = null, photoId = null, photoReading = false, photoEpoch = 0, kitchenLimit = 24;
  let coverage = [], dispatchPoint = null, locating = false, dispatchEpoch = 0, dispatchError = '';
  const keys = new Map();
  const locked = () => state.busy || state.uncertain || state.stale || photoReading || locating;
  const update = (id, key, build) => { const value = JSON.stringify(key); if (keys.get(id) !== value) { keys.set(id, value); const root = field(id); root.replaceChildren(); build(root); } };
  const button = (label, click, secondary = false) => { const b = text('button', label, `button ${secondary ? 'button-outline' : 'button-primary'}`); b.type = 'button'; b.disabled = locked(); b.addEventListener('click', click); return b; };
  function mealPhoto(id, label, className = 'food-meal-photo') {
    const img = text('img'); img.alt = label; img.className = className; img.hidden = true; img.loading = 'lazy';
    const owner = ownerId;
    void controller.photo(id).then((uri) => { if (uri && ownerId === owner) { img.src = uri; img.hidden = false; } });
    return img;
  }
  const pickupAddress = (restaurant) => restaurant.addressHidden ? `${foodAreaLabel(restaurant.areaId)} · Private collection point shared when food is ready` : restaurant.address;
  async function sellHome() {
    if (await controller.navigate('store')) { if (!state.store) { field('store-type').value = 'home_kitchen'; storeDirty = true; storeAddressFields(); } field('store-name').focus(); }
  }
  for (const id of ['sell-home', 'home-start']) field(id).addEventListener('click', () => void sellHome());
  for (const mode of ['delivery', 'pickup']) field(mode + '-mode').addEventListener('click', () => controller.fulfillment(mode));
  field('fulfillment').addEventListener('change', () => controller.fulfillment(field('fulfillment').value));
  field('restaurants-more').addEventListener('click', () => { kitchenLimit += 24; render(state); });
  function totals(value) {
    const dl = text('dl', undefined, 'food-money');
    for (const [name, key] of [['Food subtotal', 'subtotalKobo'], ['Delivery', 'deliveryFeeKobo'], ['Service fee · 5%, capped at ₦1,000', 'serviceFeeKobo'], ['Order total', 'totalKobo']]) {
      const row = text('div'); row.append(text('dt', name), text('dd', formatNaira(value[key]))); dl.append(row);
    }
    return dl;
  }
  function orders(root, values, empty = 'No food orders yet.') {
    if (!values.length) root.append(text('p', empty, 'food-notice'));
    for (const order of values) {
      const card = text('article', undefined, 'food-card'), top = text('div', undefined, 'food-order-top');
      top.append(text('h3', order.restaurant.name), text('span', EATS_STATUS[order.status], 'food-tag')); card.append(top);
      card.append(text('p', `${order.fulfillment === 'pickup' ? 'Customer pickup' : 'Delivery'} · ${order.lines.reduce((sum, i) => sum + i.quantity, 0)} items · ${formatNaira(order.totals.totalKobo)} · ${new Date(order.createdAt).toLocaleString()}`));
      card.append(button('Open order', () => void controller.navigate('order', order.id), true)); root.append(card);
    }
  }
  for (const name of ['cuisine', 'store-cuisine']) for (const cuisine of EATS_CUISINES) { const option = text('option', cuisine); option.value = cuisine; field(name).append(option); }
  for (const screen of ['browse','orders','store','work','review']) field(screen).addEventListener('click', () => void navigate(screen));
  field('refresh').addEventListener('click', () => void controller.refresh());
  field('retry').addEventListener('click', () => void controller.retry());
  field('replace-yes').addEventListener('click', () => void controller.selectRestaurant(state.replaceRestaurantId, true));
  field('replace-no').addEventListener('click', controller.keepRestaurant);
  field('orders-more').addEventListener('click', () => void controller.refresh({ before: state.nextBefore }));
  field('store-orders-more').addEventListener('click', () => void controller.refresh({ before: state.storeNextBefore }));
  for (const id of ['search','cuisine','seller-filter','sort','open-only']) field(id).addEventListener(['search', 'town-filter'].includes(id) ? 'input' : 'change', () => { kitchenLimit = 24; render(state); });
  field('kitchen-filter-apply').addEventListener('click', () => {
    if (locked() || state.loading) return;
    try { void controller.browseLocation(foodAreaId(field('state-filter').value, field('town-filter').value)); }
    catch { field('error').textContent = 'Choose a state and enter the kitchen’s town or local area.'; }
  });
  field('kitchen-filter-clear').addEventListener('click', () => { if (!locked() && !state.loading) void controller.browseLocation(''); });
  const deliveryLocation = createFoodLocationFields({ state: field('state'), town: field('town'), onChange: () => delivery() });
  function delivery() { const address = { line: field('address').value, areaId: deliveryLocation.value() }; keys.set('delivery-address', JSON.stringify(address)); controller.delivery(address, field('instructions').value); }
  field('address').addEventListener('input', delivery); field('instructions').addEventListener('input', delivery);
  field('checkout-form').addEventListener('submit', (event) => { event.preventDefault(); delivery(); void controller.checkout(); });
  field('place').addEventListener('click', () => void controller.place());
  field('order-back').addEventListener('click', () => void controller.navigate(({ store: 'store', courier: 'work', admin: 'review' })[state.order?.role] ?? 'orders'));
  field('order-action-form').addEventListener('submit', (event) => {
    event.preventDefault(); const action = event.submitter?.value;
    if (!state.order || !state.order.actions.includes(action) || locked()) return;
    const pin = ['pickup','deliver','complete_pickup'].includes(action), reason = ['reject','cancel'].includes(action);
    field('pin').required = pin; field('reason').required = reason;
    const collection = action === 'ready' && state.order.needsCollectionPoint; field('collection').required = Boolean(collection);
    if (!field('order-action-form').reportValidity()) return;
    void controller.orderAction(state.order, action, pin ? { pin: field('pin').value } : reason ? { reason: field('reason').value } : collection ? { collectionPoint: field('collection').value } : {}).then((ok) => {
      if (ok) { field('pin').value = ''; field('reason').value = ''; field('collection').value = ''; }
    });
  });
  const mealView = createMealView(controller, { button, mealPhoto, totals });
  const storeLocation = createFoodLocationFields({ state: field('store-state'), town: field('store-town'), onChange: (areaId) => {
    if (locked()) return; storeDirty = true; coverage = areaId ? [areaId] : []; dispatchPoint = null; dispatchEpoch++; dispatchError = ''; renderStoreLocation();
  } });
  const coverageLocation = createFoodLocationFields({ state: field('coverage-state'), town: field('coverage-town') });
  coverageLocation.required(false);
  for (const item of NIGERIAN_STATES) { const option = text('option', item.name); option.value = item.id; field('state-filter').append(option); }
  function renderStoreLocation() {
    const root = field('store-delivery-areas'); root.replaceChildren();
    for (const areaId of coverage) { const row = text('div', undefined, 'food-actions'); row.append(text('span', foodAreaLabel(areaId)), button('Remove', () => { coverage = coverage.filter((id) => id !== areaId); storeDirty = true; renderStoreLocation(); }, true)); root.append(row); }
    field('dispatch-status').textContent = dispatchError || (locating ? 'Getting your pickup location…' : dispatchPoint ? 'Private pickup location selected. Save the store to apply it.' : 'No private pickup location set. Save as a draft or offer customer pickup; courier delivery in a new town needs this location before opening for delivery.');
    if (!geolocation.supported() && !dispatchPoint && !dispatchError) field('dispatch-status').textContent += ' Location access needs a supported browser on HTTPS or localhost.';
    field('dispatch-locate').disabled = locked() || !geolocation.supported(); field('dispatch-clear').disabled = locked() || !dispatchPoint;
    field('coverage-add').disabled = locked() || coverage.length >= 50;
  }
  field('coverage-add').addEventListener('click', () => {
    if (locked()) return; const areaId = coverageLocation.value();
    if (!areaId) { field('error').textContent = 'Choose a state and enter a town or local area to add.'; return; }
    if (!coverage.includes(areaId) && coverage.length < 50) coverage.push(areaId); storeDirty = true; renderStoreLocation();
  });
  field('dispatch-clear').addEventListener('click', () => { if (locked()) return; dispatchPoint = null; dispatchError = ''; dispatchEpoch++; storeDirty = true; renderStoreLocation(); });
  field('dispatch-locate').addEventListener('click', async () => {
    if (locked() || !geolocation.supported()) return;
    const epoch = ++dispatchEpoch; locating = true; dispatchError = ''; render(state);
    try {
      const fix = await geolocation.locate(); if (epoch !== dispatchEpoch) return;
      const point = { lat: fix.coords.latitude, lng: fix.coords.longitude };
      if (!insideNigeria(point)) throw new Error('Choose a pickup location inside Nigeria.');
      if (!Number.isFinite(fix.coords.accuracy) || fix.coords.accuracy > 1000) throw new Error('Your location is not accurate enough. Try again at your pickup location.');
      dispatchPoint = point; storeDirty = true;
    } catch (error) { if (epoch === dispatchEpoch) dispatchError = error?.message || 'Could not get your location. Try again or save without it.'; }
    finally { if (epoch === dispatchEpoch) { locating = false; render(state); } }
  });
  function storeAddressFields() {
    const privateKitchen = isPrivateKitchen(field('store-type').value);
    field('store-address-row').hidden = privateKitchen; field('store-address').required = !privateKitchen;
    field('store-coverage').hidden = !field('store-delivery').checked;
  }
  field('store-type').addEventListener('change', storeAddressFields);
  field('store-delivery').addEventListener('change', storeAddressFields);
  function fillStore() {
    const s = state.store; storeVersion = s?.version ?? null; storeDirty = false;
    for (const [id, value] of Object.entries({ name: s?.name ?? '', cuisine: s?.cuisine ?? 'Nigerian', description: s?.description ?? '', address: s?.address ?? '', prep: s?.prepMinutes ?? 25, minimum: (s?.minimumKobo ?? 0) / 100, fee: (s?.deliveryFeeKobo ?? 150_000) / 100 })) field('store-' + id).value = String(value);
    field('store-type').value = s?.sellerType ?? 'restaurant'; field('store-delivery').checked = s?.deliveryEnabled !== false; field('store-pickup').checked = s?.pickupEnabled ?? false;
    storeLocation.set(s?.areaId ?? ''); coverageLocation.set(s?.areaId ?? '');
    coverage = [...(s?.deliveryAreaIds ?? (s?.areaId ? [s.areaId] : []))]; dispatchPoint = s?.dispatchPoint ?? null; dispatchError = ''; dispatchEpoch++; locating = false; renderStoreLocation();
    storeAddressFields(); field('store-stale').hidden = true;
  }
  field('store-form').addEventListener('input', () => { storeDirty = true; });
  field('store-reload').addEventListener('click', fillStore);
  field('store-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (locked()) return;
    try {
      const areaId = storeLocation.value(); if (!areaId) throw new Error('Choose your kitchen’s state and enter its town or local area.');
      const details = { sellerType: field('store-type').value, deliveryEnabled: field('store-delivery').checked, pickupEnabled: field('store-pickup').checked, name: field('store-name').value, cuisine: field('store-cuisine').value, description: field('store-description').value, address: isPrivateKitchen(field('store-type').value) ? '' : field('store-address').value, deliveryAreaIds: [...coverage], dispatchPoint,
        areaId, prepMinutes: Number(field('store-prep').value), minimumKobo: money(field('store-minimum').value), deliveryFeeKobo: money(field('store-fee').value) };
      const ok = state.store ? await controller.storeAction('save', { expectedVersion: storeVersion, details }) : await controller.createStore(details);
      if (ok) { fillStore(); render(controller.snapshot()); }
    } catch (error) { field('error').textContent = error.message; }
  });
  function fillItem(item = null) {
    photoEpoch++; photo = null; photoId = item?.photoId ?? null; photoReading = false; field('item-photo').value = ''; field('photo-status').textContent = photoId ? 'A saved meal photo is attached.' : 'No meal photo attached.';
    field('item-stock').value = item?.portionsRemaining == null ? '' : String(item.portionsRemaining); field('item-allergens').value = item?.allergens ?? '';
    menuId = item?.id ?? null; menuVersion = state.store?.version ?? null; menuDirty = Boolean(item);
    for (const name of ['name','description','category','price']) field('item-' + name).value = String(name === 'price' ? item ? item.priceKobo / 100 : '' : item?.[name] ?? (name === 'category' ? 'Meals' : ''));
    field('item-available').checked = item?.available ?? true; field('menu-form-title').textContent = item ? `Edit ${item.name}` : 'Add a menu item';
  }
  field('item-photo').addEventListener('change', () => {
    if (locked()) return;
    const file = field('item-photo').files?.[0]; if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 2 * 1024 * 1024) { field('error').textContent = 'Choose a JPEG or PNG meal photo up to 2 MiB.'; field('item-photo').value = ''; return; }
    if (!menuDirty) menuVersion = state.store?.version; menuDirty = true;
    const epoch = ++photoEpoch, reader = new FileReader(); photoReading = true; render(state);
    reader.onload = () => { if (epoch !== photoEpoch) return; photo = { mimeType: file.type, base64: String(reader.result).split(',')[1] }; photoId = null; photoReading = false; field('photo-status').textContent = 'New meal photo selected. Save the menu item to publish it.'; render(state); };
    reader.onerror = () => { if (epoch !== photoEpoch) return; photoReading = false; render(state); field('error').textContent = 'Could not read that photo. Choose it again.'; };
    reader.readAsDataURL(file);
  });
  field('photo-remove').addEventListener('click', () => { if (locked()) return; photoEpoch++; photo = photoId = null; if (!menuDirty) menuVersion = state.store?.version; menuDirty = true; field('item-photo').value = ''; field('photo-status').textContent = 'Photo will be removed when you save.'; });
  field('item-new').addEventListener('click', () => fillItem());
  field('menu-form').addEventListener('input', () => { if (!menuDirty) menuVersion = state.store?.version; menuDirty = true; });
  field('menu-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (locked()) return;
    try {
      const item = { name: field('item-name').value, description: field('item-description').value, category: field('item-category').value, priceKobo: money(field('item-price').value), available: field('item-available').checked, portionsRemaining: field('item-stock').value.trim() === '' ? null : Number(field('item-stock').value), allergens: field('item-allergens').value, photoId, ...(photo ? { photo } : {}) };
      if (await controller.storeAction('menu', { expectedVersion: menuVersion ?? state.store.version, itemId: menuId, item })) fillItem();
    } catch (error) { field('error').textContent = error.message; }
  });
  field('review-form').addEventListener('submit', (event) => {
    event.preventDefault(); if (!state.review || locked()) return;
    void controller.storeAction('review', { decision: event.submitter.value, reason: field('review-reason').value, reference: field('review-reference').value }, state.review.store);
  });
  function render(next) {
    state = next;
    if (ownerId !== state.user?.id) {
      ownerId = state.user?.id; keys.clear(); dispatchEpoch++; dispatchPoint = null; locating = false; coverage = []; dispatchError = ''; deliveryLocation.set(''); storeLocation.set(''); coverageLocation.set(''); photoEpoch++; photo = photoId = null; photoReading = false; kitchenLimit = 24; storeDirty = menuDirty = false; storeVersion = undefined; menuVersion = menuId = null;
      for (const id of ['address','instructions','pin','reason','review-reference','review-reason','search','collection','photo-status','town-filter','state-filter']) field(id).value = '';
      for (const id of ['restaurants','restaurant-heading','menu-list','cart-lines','quote-totals','orders-list','store-summary','store-menu','store-orders','work-current','work-list','order-detail','order-buttons','review-list','review-profile']) field(id).replaceChildren();
      field('store-form').reset(); field('menu-form').reset();
    }
    mealView.render(state);
    field('intro').hidden = sellerPage() || Boolean(state.user);
    field('seller-intro').hidden = !sellerPage() && state.screen !== 'store';
    field('seller-sign-in').hidden = Boolean(state.user);
    field('app').hidden = !state.user; field('auth').hidden = Boolean(state.user);
    if (!state.user) return;
    const admin = state.user.role === 'admin';
    field('review').hidden = !admin; field('work').hidden = !state.user.driver; field('store').hidden = admin; field('orders').hidden = admin;
    for (const screen of ['browse','orders','store','work','review','order']) field('screen-' + screen).hidden = state.screen !== screen;
    for (const screen of ['browse','orders','store','work','review']) { field(screen).setAttribute('aria-current', state.screen === screen ? 'page' : 'false'); field(screen).disabled = state.busy || state.uncertain; }
    field('error').textContent = state.error; field('notice').textContent = state.notice; field('loading').hidden = !state.loading;
    field('uncertain').hidden = !state.uncertain; field('retry').disabled = state.busy;
    field('refresh').disabled = state.busy || state.uncertain || state.loading;
    for (const name of ['checkout','store','menu','order-action','review']) field(name + '-fields').disabled = locked();
    field('sell-home').hidden = field('home-start').hidden = admin;
    field('sell-home').disabled = field('home-start').disabled = locked();
    field('replace').hidden = !state.replaceRestaurantId;
    field('replace-yes').disabled = field('replace-no').disabled = locked();
    renderStoreLocation();
    field('kitchen-location-fields').disabled = locked() || state.loading; field('kitchen-filter-clear').disabled = locked() || state.loading || !state.catalogAreaId;
    field('kitchen-filter-status').textContent = state.catalogAreaId ? `Kitchen location: ${foodAreaLabel(state.catalogAreaId)}.${state.fulfillment === 'delivery' ? ' Delivery choices also match your delivery address.' : ' Collect your food yourself.'}` : 'Choose a state and town to find kitchens. Delivery choices must serve your delivery address.';
    if (keys.get('catalog-area') !== (state.catalogAreaId ?? '')) { keys.set('catalog-area', state.catalogAreaId ?? ''); const area = resolveFoodArea(state.catalogAreaId); field('state-filter').value = area?.stateId ?? ''; field('town-filter').value = area?.town ?? ''; }
    for (const mode of ['delivery', 'pickup']) { field(mode + '-mode').setAttribute('aria-pressed', String(state.fulfillment === mode)); field(mode + '-mode').disabled = state.busy || state.uncertain; }
    field('fulfillment').value = state.fulfillment; field('delivery-fields').hidden = state.fulfillment === 'pickup'; field('address').required = state.fulfillment !== 'pickup'; field('pickup-note').hidden = state.fulfillment !== 'pickup';
    field('item-stock').required = state.store?.sellerType === 'home_kitchen';
    if (keys.get('delivery-address') !== JSON.stringify(state.address)) { keys.set('delivery-address', JSON.stringify(state.address)); field('address').value = state.address.line; deliveryLocation.set(state.address.areaId); }
    deliveryLocation.required(state.fulfillment !== 'pickup'); field('instructions').value = state.instructions;
    const query = field('search').value.toLowerCase().trim(), cuisine = field('cuisine').value;
    update('cuisine-chips', [cuisine, locked()], (root) => {
      for (const value of ['', ...EATS_CUISINES]) { const chip = button('', () => { field('cuisine').value = value; kitchenLimit = 24; render(state); }, true); chip.setAttribute('aria-pressed', String(cuisine === value)); chip.append(text('span', EATS_SYMBOLS[value] ?? '🍽️'), text('span', value || 'All food')); root.append(chip); }
    });
    const sellerType = field('seller-filter').value, sort = field('sort').value, openOnly = field('open-only').checked;
    update('restaurants', [state.restaurants, query, cuisine, state.catalogAreaId, sellerType, sort, openOnly, state.fulfillment, kitchenLimit, locked()], (root) => {
      const restaurants = discoverKitchens(state.restaurants, { q: query, cuisine, sellerType, sort, openOnly, fulfillment: state.fulfillment });
      field('results').textContent = `${restaurants.length} ${restaurants.length === 1 ? 'kitchen' : 'kitchens'} · ${state.fulfillment === 'pickup' ? 'Customer pickup' : 'Delivery'}`;
      field('restaurants-more').hidden = restaurants.length <= kitchenLimit;
      if (!restaurants.length) { const empty = text('div', undefined, 'food-empty'); empty.append(text('h3', state.restaurants.length ? 'Let’s try another craving.' : 'Make room at the table.'), text('p', state.restaurants.length ? 'Try another area, kitchen type or order option.' : 'The first kitchens are on their way. Create a test home kitchen, add a menu and complete staff review to explore the ordering flow.')); if (!admin) empty.append(button('Start a home kitchen', () => void sellHome())); root.append(empty); }
      for (const store of restaurants.slice(0, kitchenLimit)) {
        const card = text('article', undefined, 'food-card food-restaurant'), cover = text('div', store.coverPhotoId ? '' : EATS_SYMBOLS[store.cuisine], 'food-cover ' + store.cuisine.toLowerCase());
        if (store.coverPhotoId) cover.append(mealPhoto(store.coverPhotoId, `${store.name} · meal photo supplied by the kitchen`, 'food-cover-photo'));
        else cover.setAttribute('aria-hidden', 'true');
        const info = text('div', undefined, 'food-restaurant-info');
        info.append(text('span', EATS_SELLERS[store.sellerType ?? 'restaurant'], 'food-kitchen-type'), text('h3', store.name), text('span', store.isOpen ? 'OPEN FOR TEST ORDERS' : 'CLOSED', 'food-tag' + (store.isOpen ? '' : ' closed')),
          text('p', store.description, 'small-note'), text('p', `${store.cuisine} · ${foodAreaLabel(store.areaId)}`),
          ...(!isPrivateKitchen(store.sellerType) ? [text('p', store.address, 'small-note')] : []),
          text('p', `${store.prepMinutes} min preparation · ${state.fulfillment === 'pickup' ? 'Pickup · no delivery fee' : formatNaira(store.deliveryFeeKobo) + ' delivery'}`, 'small-note'),
          button('View menu', () => { void controller.selectRestaurant(store.id).then((ok) => { if (ok) field('shopping').scrollIntoView({ behavior: 'smooth', block: 'start' }); }); }));
        card.append(cover, info); root.append(card);
      }
    });
    field('shopping').hidden = !state.restaurant;
    update('restaurant-heading', state.restaurant, (root) => { if (state.restaurant) root.append(text('h2', state.restaurant.name), text('p', EATS_SELLERS[state.restaurant.sellerType ?? 'restaurant'], 'food-kitchen-type'), text('p', pickupAddress(state.restaurant)), text('p', `${state.restaurant.prepMinutes} min preparation · Minimum ${formatNaira(state.restaurant.minimumKobo)} · ${state.restaurant.isOpen ? 'Open for test orders' : 'Closed'}`, 'small-note')); });
    update('menu-list', [state.menu, state.cart, state.restaurant?.isOpen, locked()], (root) => {
      for (const item of state.menu) {
        const row = text('article', undefined, 'food-menu-row'), info = text('div'), quantity = state.cart.find((l) => l.itemId === item.id)?.quantity ?? 0;
        info.append(text('span', item.category, 'food-tag'), text('h3', item.name), text('p', item.description, 'small-note'), text('strong', formatNaira(item.priceKobo)), text('p', foodStock(item), 'food-stock'));
        if (item.allergens) info.append(text('p', `Allergens: ${item.allergens}`, 'small-note'));
        const controls = text('div', undefined, 'food-quantity');
        const less = button('−', () => controller.quantity(item.id, quantity - 1)), more = button('+', () => controller.quantity(item.id, quantity + 1));
        less.setAttribute('aria-label', `Remove one ${item.name}`); more.setAttribute('aria-label', `Add one ${item.name}`);
        less.disabled ||= quantity === 0; more.disabled ||= quantity >= Math.min(20, item.portionsRemaining ?? 20) || !foodAvailable(item) || !state.restaurant?.isOpen;
        controls.append(less, text('span', String(quantity)), more); row.append(info, controls); if (item.photoId) row.append(mealPhoto(item.photoId, item.name)); root.append(row);
      }
    });
    update('cart-lines', [state.cart, state.menu, locked()], (root) => {
      if (!state.cart.length) root.append(text('p', 'Choose something delicious from the menu.', 'small-note'));
      for (const line of state.cart) {
        const item = state.menu.find((i) => i.id === line.itemId), row = text('div', undefined, 'food-menu-row');
        row.append(text('p', `${line.quantity} × ${item?.name ?? 'Unavailable item'} · ${item ? formatNaira(item.priceKobo * line.quantity) : 'Remove this item before checkout'}`), button(`Remove ${item?.name ?? 'item'}`, () => controller.quantity(line.itemId, 0), true)); root.append(row);
      }
    });
    field('checkout').disabled = locked() || !state.cart.length || !state.restaurant?.isOpen || admin || (state.fulfillment === 'pickup' ? !state.restaurant?.pickupEnabled : state.restaurant?.deliveryEnabled === false);
    field('quote').hidden = !state.quote; field('place').disabled = locked() || !state.quote || state.now >= state.quote.expiresAt;
    update('quote-totals', state.quote?.totals, (root) => { if (state.quote) root.append(totals(state.quote.totals)); });
    field('quote-expiry').textContent = state.quote ? `${state.quote.fulfillment === 'pickup' ? 'Customer pickup · collect your food yourself.' : 'Delivery to ' + state.quote.address.line + '.'} Total held until ${new Date(state.quote.expiresAt).toLocaleTimeString()}.` : '';
    update('orders-list', [state.orders, locked()], (root) => orders(root, state.orders)); field('orders-more').hidden = !state.nextBefore; field('orders-more').disabled = locked() || state.loading;
    field('store-form-title').textContent = state.store ? 'Store settings' : 'Create your store';
    if (!storeDirty && storeVersion !== (state.store?.version ?? null)) fillStore();
    field('store-stale').hidden = !storeDirty || storeVersion === (state.store?.version ?? null);
    field('store-reload').hidden = !state.store; field('store-summary').hidden = !state.store; field('menu-editor').hidden = !state.store;
    update('store-summary', [state.store, locked()], (root) => { const s = state.store; if (!s) return; root.append(text('h2', s.name), text('p', EATS_SELLERS[s.sellerType ?? 'restaurant'], 'food-kitchen-type'), text('span', s.status.toUpperCase(), 'food-tag'), text('p', s.reviewNote || 'Add your menu, request staff review, then open for test orders.'), text('p', s.isOpen ? 'Open for new orders' : 'Closed to new orders')); if (s.status === 'approved') root.append(button(s.isOpen ? 'Close to new orders' : 'Open for test orders', () => void controller.storeAction('open', { isOpen: !s.isOpen }))); });
    update('store-menu', [state.storeMenu, locked()], (root) => { for (const i of state.storeMenu) { const row = text('div', undefined, 'food-menu-row'); row.append(text('p', `${i.name} · ${formatNaira(i.priceKobo)} · ${foodStock(i)}`), button('Edit item', () => { fillItem(i); field('item-name').focus(); }, true)); if (i.photoId) row.append(mealPhoto(i.photoId, i.name)); root.append(row); } });
    update('store-orders', [state.storeOrders, locked()], (root) => orders(root, state.storeOrders, 'Incoming orders will appear here while your store is open.'));
    field('store-orders-more').hidden = !state.storeNextBefore; field('store-orders-more').disabled = locked() || state.loading;
    field('work-status').textContent = state.work?.current.length ? 'Finish this food delivery before accepting another job.' : !state.work?.eligible ? 'A currently approved motorcycle, car, SUV or van is required.' : !state.work.online ? 'You are offline. Use Your availability above to see ready food orders.' : 'You are online. Choose a pickup below.';
    update('work-current', [state.work?.current, locked()], (root) => orders(root, state.work?.current ?? [], 'No food delivery in progress.'));
    update('work-list', [state.work?.available, locked()], (root) => { for (const job of state.work?.available ?? []) { const card = text('article', undefined, 'food-card'); card.append(text('h3', job.restaurant.name), text('p', `${pickupAddress(job.restaurant)} → ${foodAreaLabel(job.deliveryArea.id)}`), text('p', `Delivery fee · ${formatNaira(job.deliveryFeeKobo)} · Test order`), button('Accept delivery', () => void controller.orderAction(job, 'claim'))); root.append(card); } });
    update('order-detail', state.order, (root) => {
      const o = state.order; if (!o) return; const card = text('section', undefined, 'food-card');
      card.append(text('p', 'TEST ORDER · ' + o.id.slice(0,8).toUpperCase(), 'eyebrow'), text('h1', EATS_STATUS[o.status]), text('h2', o.restaurant.name), text('p', `${o.customerName} · ${pickupAddress(o.restaurant)}`));
      card.append(text('p', o.fulfillment === 'pickup' ? 'Customer pickup · collect your food from the kitchen' : 'Delivery', 'food-tag'));
      if (o.address.line) card.append(text('p', `Deliver to: ${o.address.line} · ${foodAreaLabel(o.address.areaId)}`));
      if (o.recipient?.kind === 'other') card.append(text('p', `Recipient: ${o.recipient.name} · ${o.recipient.phone}`));
      if (o.instructions) card.append(text('p', `Instructions: ${o.instructions}`));
      if (o.courier) card.append(text('p', `Courier: ${o.courier.name} · ${o.courier.vehicle.colour ?? ''} ${o.courier.vehicle.model} · ${o.courier.vehicle.plate}`));
      if (o.pickupPin || o.deliveryPin) card.append(text('p', o.pickupPin ? 'Kitchen pickup code · share at handover only' : o.fulfillment === 'pickup' ? 'Your pickup code · show the kitchen when collecting your food' : o.recipient?.kind === 'other' ? `Delivery code · share with ${o.recipient.name} only when the courier arrives` : 'Your delivery code · share only when you receive the food', 'small-note'), text('p', o.pickupPin ?? o.deliveryPin, 'food-pin'));
      for (const i of o.lines) card.append(text('p', `${i.quantity} × ${i.name} · ${formatNaira(i.priceKobo * i.quantity)}`));
      card.append(totals(o.totals), text('p', 'Test checkout · no money charged.', 'small-note'));
      const timeline = text('ol', undefined, 'food-timeline');
      for (const event of o.events) { const li = text('li'); li.append(text('strong', EATS_STATUS[event.status]), text('small', new Date(event.at).toLocaleString())); if (event.reason) li.append(text('p', event.reason)); timeline.append(li); }
      card.append(timeline); root.append(card);
    });
    field('collection-row').hidden = !state.order?.needsCollectionPoint;
    field('order-action-form').hidden = !state.order?.actions.length;
    field('pin-row').hidden = !state.order?.actions.some((a) => ['pickup','deliver','complete_pickup'].includes(a)); field('reason-row').hidden = !state.order?.actions.some((a) => ['cancel','reject'].includes(a));
    update('order-buttons', [state.order?.actions, locked()], (root) => { for (const action of state.order?.actions ?? []) { const b = button(actionLabels[action], () => {}, ['cancel','reject'].includes(action)); b.type = 'submit'; b.value = action; b.formNoValidate = true; root.append(b); } });
    update('review-list', [state.reviewStores, locked()], (root) => { for (const s of state.reviewStores) { const card = text('article', undefined, 'food-card'); card.append(text('h3', s.name), text('p', `${EATS_SELLERS[s.sellerType ?? 'restaurant']} · ${s.status} · ${s.cuisine} · ${pickupAddress(s) || s.areaId}`), button('Review store and menu', () => void controller.reviewStore(s.id), true)); root.append(card); } });
    field('review-detail').hidden = !state.review;
    update('review-profile', state.review, (root) => { field('review-reference').value = field('review-reason').value = ''; const s = state.review; if (!s) return; root.append(text('h2', s.store.name), text('p', EATS_SELLERS[s.store.sellerType ?? 'restaurant']), text('p', s.store.description), text('p', pickupAddress(s.store) || s.store.areaId), text('p', `Delivery: ${s.store.deliveryEnabled !== false ? 'yes' : 'no'} · Customer pickup: ${s.store.pickupEnabled ? 'yes' : 'no'}`), text('p', `${s.store.prepMinutes} min preparation · ${formatNaira(s.store.deliveryFeeKobo)} delivery`)); for (const i of s.menu) { root.append(text('p', `${i.name} · ${formatNaira(i.priceKobo)} · ${i.description}`)); if (i.photoId) root.append(mealPhoto(i.photoId, i.name)); } });
  }
  return { render };
}
