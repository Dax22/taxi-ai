import { $, element } from '../dashboard/dom.mjs';
import { EATS_CUISINES, EATS_SYMBOLS, EATS_STATUS } from '/shared/eats.mjs';
import { formatNaira } from '/shared/demo-booking.mjs';
const actionLabels = { accept: 'Accept order', reject: 'Decline order', prepare: 'Start preparing', ready: 'Ready for pickup', claim: 'Accept delivery', pickup: 'Confirm food collected', arrive: 'I’m at the delivery address', deliver: 'Confirm delivered', cancel: 'Cancel order' };
const field = (id) => $('food-' + id);
const text = (tag, value, className) => element(tag, value, className);
const money = (value) => { const n = Number(value); if (!Number.isFinite(n) || n < 0 || !/^\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter an amount with up to two decimal places.'); return Math.round(n * 100); };
export function createEatsView(controller) {
  let state, ownerId = null, storeDirty = false, storeVersion = null, menuId = null, menuVersion = null, menuDirty = false;
  const keys = new Map();
  const locked = () => state.busy || state.uncertain || state.stale;
  const update = (id, key, build) => { const value = JSON.stringify(key); if (keys.get(id) !== value) { keys.set(id, value); const root = field(id); root.replaceChildren(); build(root); } };
  const button = (label, click, secondary = false) => { const b = text('button', label, `button ${secondary ? 'button-outline' : 'button-primary'}`); b.type = 'button'; b.disabled = locked(); b.addEventListener('click', click); return b; };
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
      card.append(text('p', `${order.lines.reduce((sum, i) => sum + i.quantity, 0)} items · ${formatNaira(order.totals.totalKobo)} · ${new Date(order.createdAt).toLocaleString()}`));
      card.append(button('Open order', () => void controller.navigate('order', order.id), true)); root.append(card);
    }
  }
  function areaOptions(node, areas, first = null) {
    const value = node.value; node.replaceChildren();
    for (const area of [...(first ? [{ id: '', name: first }] : []), ...areas]) { const option = text('option', area.name); option.value = area.id; node.append(option); }
    if (areas.some((area) => area.id === value) || first && value === '') node.value = value;
  }
  for (const name of ['cuisine', 'store-cuisine']) for (const cuisine of EATS_CUISINES) { const option = text('option', cuisine); option.value = cuisine; field(name).append(option); }
  for (const screen of ['browse','orders','store','work','review']) field(screen).addEventListener('click', () => void controller.navigate(screen));
  field('refresh').addEventListener('click', () => void controller.refresh());
  field('retry').addEventListener('click', () => void controller.retry());
  field('replace-yes').addEventListener('click', () => void controller.selectRestaurant(state.replaceRestaurantId, true));
  field('replace-no').addEventListener('click', controller.keepRestaurant);
  field('orders-more').addEventListener('click', () => void controller.refresh({ before: state.nextBefore }));
  field('store-orders-more').addEventListener('click', () => void controller.refresh({ before: state.storeNextBefore }));
  for (const id of ['search','cuisine','area-filter']) field(id).addEventListener(id === 'search' ? 'input' : 'change', () => render(state));
  function delivery() { controller.delivery({ line: field('address').value, areaId: field('area').value }, field('instructions').value); }
  field('checkout-form').addEventListener('input', delivery); field('area').addEventListener('change', delivery);
  field('checkout-form').addEventListener('submit', (event) => { event.preventDefault(); delivery(); void controller.checkout(); });
  field('place').addEventListener('click', () => void controller.place());
  field('order-back').addEventListener('click', () => void controller.navigate(({ store: 'store', courier: 'work', admin: 'review' })[state.order?.role] ?? 'orders'));
  field('order-action-form').addEventListener('submit', (event) => {
    event.preventDefault(); const action = event.submitter?.value;
    if (!state.order || !state.order.actions.includes(action) || locked()) return;
    const pin = ['pickup','deliver'].includes(action), reason = ['reject','cancel'].includes(action);
    field('pin').required = pin; field('reason').required = reason;
    if (!field('order-action-form').reportValidity()) return;
    void controller.orderAction(state.order, action, pin ? { pin: field('pin').value } : reason ? { reason: field('reason').value } : {}).then((ok) => {
      if (ok) { field('pin').value = ''; field('reason').value = ''; }
    });
  });
  function fillStore() {
    const s = state.store; storeVersion = s?.version ?? null; storeDirty = false;
    for (const [id, value] of Object.entries({ name: s?.name ?? '', cuisine: s?.cuisine ?? 'Nigerian', description: s?.description ?? '', address: s?.address ?? '', area: s?.areaId ?? 'wuse-ii', prep: s?.prepMinutes ?? 25, minimum: (s?.minimumKobo ?? 0) / 100, fee: (s?.deliveryFeeKobo ?? 150_000) / 100 })) field('store-' + id).value = String(value);
    field('store-stale').hidden = true;
  }
  field('store-form').addEventListener('input', () => { storeDirty = true; });
  field('store-reload').addEventListener('click', fillStore);
  field('store-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (locked()) return;
    try {
      const details = { name: field('store-name').value, cuisine: field('store-cuisine').value, description: field('store-description').value, address: field('store-address').value,
        areaId: field('store-area').value, prepMinutes: Number(field('store-prep').value), minimumKobo: money(field('store-minimum').value), deliveryFeeKobo: money(field('store-fee').value) };
      const ok = state.store ? await controller.storeAction('save', { expectedVersion: storeVersion, details }) : await controller.createStore(details);
      if (ok) { fillStore(); render(controller.snapshot()); }
    } catch (error) { field('error').textContent = error.message; }
  });
  function fillItem(item = null) {
    menuId = item?.id ?? null; menuVersion = state.store?.version ?? null; menuDirty = Boolean(item);
    for (const name of ['name','description','category','price']) field('item-' + name).value = String(name === 'price' ? item ? item.priceKobo / 100 : '' : item?.[name] ?? (name === 'category' ? 'Meals' : ''));
    field('item-available').checked = item?.available ?? true; field('menu-form-title').textContent = item ? `Edit ${item.name}` : 'Add a menu item';
  }
  field('item-new').addEventListener('click', () => fillItem());
  field('menu-form').addEventListener('input', () => { if (!menuDirty) menuVersion = state.store?.version; menuDirty = true; });
  field('menu-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (locked()) return;
    try {
      const item = { name: field('item-name').value, description: field('item-description').value, category: field('item-category').value, priceKobo: money(field('item-price').value), available: field('item-available').checked };
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
      ownerId = state.user?.id; keys.clear(); storeDirty = menuDirty = false; storeVersion = menuVersion = menuId = null;
      for (const id of ['address','instructions','pin','reason','review-reference','review-reason','search']) field(id).value = '';
      for (const id of ['restaurants','restaurant-heading','menu-list','cart-lines','quote-totals','orders-list','store-summary','store-menu','store-orders','work-current','work-list','order-detail','order-buttons','review-list','review-profile']) field(id).replaceChildren();
      field('store-form').reset(); field('menu-form').reset();
    }
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
    field('replace').hidden = !state.replaceRestaurantId;
    field('replace-yes').disabled = field('replace-no').disabled = locked();
    const areasKey = JSON.stringify(state.areas);
    if (keys.get('areas') !== areasKey) { keys.set('areas', areasKey); for (const id of ['area','store-area']) areaOptions(field(id), state.areas); areaOptions(field('area-filter'), state.areas, 'All Abuja areas'); }
    field('address').value = state.address.line; field('area').value = state.address.areaId; field('instructions').value = state.instructions;
    const query = field('search').value.toLowerCase().trim(), cuisine = field('cuisine').value, area = field('area-filter').value;
    update('restaurants', [state.restaurants, query, cuisine, area, locked()], (root) => {
      const restaurants = state.restaurants.filter((s) => (!cuisine || s.cuisine === cuisine) && (!area || s.areaId === area) && (!query || `${s.name} ${s.cuisine} ${s.description}`.toLowerCase().includes(query)));
      if (!restaurants.length) root.append(text('p', state.restaurants.length ? 'No kitchens match these filters.' : 'No approved restaurants yet. Create a test kitchen in My store, add its menu, then ask your Taxi Ai administrator to review it.', 'food-notice'));
      for (const store of restaurants) {
        const card = text('article', undefined, 'food-card food-restaurant'), cover = text('div', EATS_SYMBOLS[store.cuisine], 'food-cover ' + store.cuisine.toLowerCase()); cover.setAttribute('aria-hidden','true');
        const info = text('div', undefined, 'food-restaurant-info'); info.append(text('span', store.isOpen ? 'ACCEPTING TEST ORDERS' : 'CLOSED', 'food-tag' + (store.isOpen ? '' : ' closed')), text('h3', store.name), text('p', store.description, 'small-note'), text('p', `${store.cuisine} · ${state.areas.find((a) => a.id === store.areaId)?.name ?? store.areaId}`), text('p', `${store.prepMinutes} min preparation · ${formatNaira(store.deliveryFeeKobo)} delivery`, 'small-note'), button('View menu', () => { void controller.selectRestaurant(store.id).then((ok) => { if (ok) field('shopping').scrollIntoView({ behavior: 'smooth', block: 'start' }); }); })); card.append(cover, info); root.append(card);
      }
    });
    field('shopping').hidden = !state.restaurant;
    update('restaurant-heading', state.restaurant, (root) => { if (state.restaurant) root.append(text('h2', state.restaurant.name), text('p', state.restaurant.address), text('p', `${state.restaurant.prepMinutes} min preparation · Minimum ${formatNaira(state.restaurant.minimumKobo)} · ${state.restaurant.isOpen ? 'Open for test orders' : 'Closed'}`, 'small-note')); });
    update('menu-list', [state.menu, state.cart, state.restaurant?.isOpen, locked()], (root) => {
      for (const item of state.menu) {
        const row = text('article', undefined, 'food-menu-row'), info = text('div'), quantity = state.cart.find((l) => l.itemId === item.id)?.quantity ?? 0;
        info.append(text('span', item.category, 'food-tag'), text('h3', item.name), text('p', item.description, 'small-note'), text('strong', formatNaira(item.priceKobo)));
        const controls = text('div', undefined, 'food-quantity');
        const less = button('−', () => controller.quantity(item.id, quantity - 1)), more = button('+', () => controller.quantity(item.id, quantity + 1));
        less.setAttribute('aria-label', `Remove one ${item.name}`); more.setAttribute('aria-label', `Add one ${item.name}`);
        less.disabled ||= quantity === 0; more.disabled ||= quantity >= 20 || !item.available || !state.restaurant?.isOpen;
        controls.append(less, text('span', String(quantity)), more); row.append(info, controls); root.append(row);
      }
    });
    update('cart-lines', [state.cart, state.menu, locked()], (root) => {
      if (!state.cart.length) root.append(text('p', 'Choose something delicious from the menu.', 'small-note'));
      for (const line of state.cart) {
        const item = state.menu.find((i) => i.id === line.itemId), row = text('div', undefined, 'food-menu-row');
        row.append(text('p', `${line.quantity} × ${item?.name ?? 'Unavailable item'} · ${item ? formatNaira(item.priceKobo * line.quantity) : 'Remove this item before checkout'}`), button(`Remove ${item?.name ?? 'item'}`, () => controller.quantity(line.itemId, 0), true)); root.append(row);
      }
    });
    field('checkout').disabled = locked() || !state.cart.length || !state.restaurant?.isOpen || admin;
    field('quote').hidden = !state.quote; field('place').disabled = locked() || !state.quote || state.now >= state.quote.expiresAt;
    update('quote-totals', state.quote?.totals, (root) => { if (state.quote) root.append(totals(state.quote.totals)); });
    field('quote-expiry').textContent = state.quote ? `Total held until ${new Date(state.quote.expiresAt).toLocaleTimeString()}.` : '';
    update('orders-list', [state.orders, locked()], (root) => orders(root, state.orders)); field('orders-more').hidden = !state.nextBefore; field('orders-more').disabled = locked() || state.loading;
    field('store-form-title').textContent = state.store ? 'Store settings' : 'Create your store';
    if (!storeDirty && storeVersion !== state.store?.version) fillStore();
    field('store-stale').hidden = !storeDirty || storeVersion === state.store?.version;
    field('store-reload').hidden = !state.store; field('store-summary').hidden = !state.store; field('menu-editor').hidden = !state.store;
    update('store-summary', [state.store, locked()], (root) => { const s = state.store; if (!s) return; root.append(text('h2', s.name), text('span', s.status.toUpperCase(), 'food-tag'), text('p', s.reviewNote || 'Add your menu, request staff review, then open for test orders.'), text('p', s.isOpen ? 'Open for new orders' : 'Closed to new orders')); if (s.status === 'approved') root.append(button(s.isOpen ? 'Close to new orders' : 'Open for test orders', () => void controller.storeAction('open', { isOpen: !s.isOpen }))); });
    update('store-menu', [state.storeMenu, locked()], (root) => { for (const i of state.storeMenu) { const row = text('div', undefined, 'food-menu-row'); row.append(text('p', `${i.name} · ${formatNaira(i.priceKobo)} · ${i.available ? 'Available' : 'Sold out'}`), button('Edit item', () => { fillItem(i); field('item-name').focus(); }, true)); root.append(row); } });
    update('store-orders', [state.storeOrders, locked()], (root) => orders(root, state.storeOrders, 'Incoming orders will appear here while your store is open.'));
    field('store-orders-more').hidden = !state.storeNextBefore; field('store-orders-more').disabled = locked() || state.loading;
    field('work-status').textContent = state.work?.current.length ? 'Finish this food delivery before accepting another job.' : !state.work?.eligible ? 'A currently approved motorcycle, car, SUV or van is required.' : !state.work.online ? 'You are offline. Use Your availability above to see ready food orders.' : 'You are online. Choose a pickup below.';
    update('work-current', [state.work?.current, locked()], (root) => orders(root, state.work?.current ?? [], 'No food delivery in progress.'));
    update('work-list', [state.work?.available, locked()], (root) => { for (const job of state.work?.available ?? []) { const card = text('article', undefined, 'food-card'); card.append(text('h3', job.restaurant.name), text('p', `${job.restaurant.address} → ${job.deliveryArea.name}`), text('p', `Delivery fee · ${formatNaira(job.deliveryFeeKobo)} · Test order`), button('Accept delivery', () => void controller.orderAction(job, 'claim'))); root.append(card); } });
    update('order-detail', state.order, (root) => {
      const o = state.order; if (!o) return; const card = text('section', undefined, 'food-card');
      card.append(text('p', 'TEST ORDER · ' + o.id.slice(0,8).toUpperCase(), 'eyebrow'), text('h1', EATS_STATUS[o.status]), text('h2', o.restaurant.name), text('p', `${o.customerName} · ${o.restaurant.address}`));
      if (o.address.line) card.append(text('p', `Deliver to: ${o.address.line}`));
      if (o.instructions) card.append(text('p', `Instructions: ${o.instructions}`));
      if (o.courier) card.append(text('p', `Courier: ${o.courier.name} · ${o.courier.vehicle.colour ?? ''} ${o.courier.vehicle.model} · ${o.courier.vehicle.plate}`));
      if (o.pickupPin || o.deliveryPin) card.append(text('p', o.pickupPin ? 'Restaurant pickup code · share at handover only' : 'Your delivery code · share only when you receive the food', 'small-note'), text('p', o.pickupPin ?? o.deliveryPin, 'food-pin'));
      for (const i of o.lines) card.append(text('p', `${i.quantity} × ${i.name} · ${formatNaira(i.priceKobo * i.quantity)}`));
      card.append(totals(o.totals), text('p', 'Test checkout · no money charged.', 'small-note'));
      const timeline = text('ol', undefined, 'food-timeline');
      for (const event of o.events) { const li = text('li'); li.append(text('strong', EATS_STATUS[event.status]), text('small', new Date(event.at).toLocaleString())); if (event.reason) li.append(text('p', event.reason)); timeline.append(li); }
      card.append(timeline); root.append(card);
    });
    field('order-action-form').hidden = !state.order?.actions.length;
    field('pin-row').hidden = !state.order?.actions.some((a) => ['pickup','deliver'].includes(a)); field('reason-row').hidden = !state.order?.actions.some((a) => ['cancel','reject'].includes(a));
    update('order-buttons', [state.order?.actions, locked()], (root) => { for (const action of state.order?.actions ?? []) { const b = button(actionLabels[action], () => {}, ['cancel','reject'].includes(action)); b.type = 'submit'; b.value = action; b.formNoValidate = true; root.append(b); } });
    update('review-list', [state.reviewStores, locked()], (root) => { for (const s of state.reviewStores) { const card = text('article', undefined, 'food-card'); card.append(text('h3', s.name), text('p', `${s.status} · ${s.cuisine} · ${s.address}`), button('Review store and menu', () => void controller.reviewStore(s.id), true)); root.append(card); } });
    field('review-detail').hidden = !state.review;
    update('review-profile', state.review, (root) => { field('review-reference').value = field('review-reason').value = ''; const s = state.review; if (!s) return; root.append(text('h2', s.store.name), text('p', s.store.description), text('p', s.store.address), text('p', `${s.store.prepMinutes} min preparation · ${formatNaira(s.store.deliveryFeeKobo)} delivery`)); for (const i of s.menu) root.append(text('p', `${i.name} · ${formatNaira(i.priceKobo)} · ${i.description}`)); });
  }
  return { render };
}
