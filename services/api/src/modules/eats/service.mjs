import { EATS_TERMINAL, EATS_DISPATCH_RADIUS_METERS, EATS_LEGACY_AREA_IDS, eatsActions, foodAvailable, discoverKitchens, isPrivateKitchen } from '../../../../../packages/shared/src/eats.mjs';
import { matchMeals, mealTotals, MEAL_LIMITS } from '../../../../../packages/shared/src/eats-meals.mjs';
import { LEGACY_FOOD_AREAS } from '../../../../../packages/shared/src/nigeria-areas.mjs';
import { distanceMeters } from '../../../../../packages/shared/src/locations.mjs';
import { hasCapability, requireEligibleDriver, requireRole } from '../../shared/policies.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { check } from '../../shared/errors.mjs';
import { canonical, version, storeDetails, menuDetails, checkedBasket, area } from './domain.mjs';
import { asyncMap, asyncFlatMap, asyncSome, asyncFilter } from '../../shared/async-collections.mjs';


/** Stores and food orders own their state; other work is checked through injected ports. */
export function createEatsService({ repository, getAccount, hasOtherWork, availabilityFor, onClaim, photoCodec, tokens, unitOfWork, audit, clock, normalisePhoto }) {
  const actor = async (user) => { const fresh = (await getAccount(user?.id)); check(fresh, 'UNAUTHENTICATED', 'Sign in to continue.'); return fresh; };
  const identifier = (id) => { check(typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id), 'INVALID_ID', 'Choose a valid record.'); return id; };
  const storeRecord = async (id) => { const value = (await repository.store(identifier(id))); check(value, 'NOT_FOUND', 'Restaurant not found.'); return value; };
  const member = async (user, id) => (await repository.membership(user.id))?.storeId === id;
  const dispatchReady = (store) => Boolean(store.dispatchPoint) || EATS_LEGACY_AREA_IDS.includes(store.areaId);
  const ownStore = async (user, id) => { check((await member(user, id)), 'FORBIDDEN', 'Only this store’s owner can manage it.'); return (await storeRecord(id)); };
  // Honour privacy in both historical snapshots and the current profile after a seller-type change.
  const privateKitchen = async (kitchen) => isPrivateKitchen(kitchen.sellerType) || isPrivateKitchen((await repository.store(kitchen.id))?.sellerType);
  const kitchenView = async (kitchen, reveal = false) => {
    const hidden = (await privateKitchen(kitchen)) && (!reveal || !kitchen.address);
    const { dispatchPoint, ...profile } = kitchen;
    return { ...profile, town: area(kitchen.areaId).name, address: hidden ? '' : kitchen.address, addressHidden: hidden };
  };
  const menuView = (items) => items.map(({ batchId, ...item }) => item);
  const snapshotView = async (snapshot, reveal = false) => ({ ...snapshot, fulfillment: snapshot.fulfillment ?? 'delivery',
    restaurant: (await kitchenView(snapshot.restaurant, reveal)), lines: menuView(snapshot.lines) });
  // Inventory and order writes share the command transaction, including retries and rollback.
  async function reserve(snapshot, store, now) {
    let changed = false;
    for (const line of snapshot.lines) {
      const item = (await repository.menuItem(line.itemId));
      check(item && foodAvailable(item) && (item.portionsRemaining == null || item.portionsRemaining >= line.quantity), 'MENU_CHANGED', 'A batch sold out. Refresh the menu and review your quantities.');
      if (item.portionsRemaining != null) { const { id, storeId, ...details } = item; details.portionsRemaining -= line.quantity; (await repository.saveMenu(id, storeId, details)); changed = true; }
    }
    if (changed) { store.version++; store.updatedAt = now; (await repository.saveStore(store)); }
  }
  async function release(order, now) {
    if (!['placed', 'accepted'].includes(order.status)) return;
    let changed = false;
    for (const line of order.snapshot.lines) {
      const item = (await repository.menuItem(line.itemId));
      // Editing/restocking an item starts a new batch; an old cancellation cannot inflate it.
      if (line.batchId && item?.batchId === line.batchId && item.portionsRemaining != null) {
        const { id, storeId, ...details } = item; details.portionsRemaining += line.quantity;
        (await repository.saveMenu(id, storeId, details)); changed = true;
      }
    }
    if (changed) { const store = (await storeRecord(order.storeId)); store.version++; store.updatedAt = now; (await repository.saveStore(store)); }
  }
  async function storeView(user, id) {
    const store = (await storeRecord(id)), managing = user.role === 'admin' || (await member(user, id));
    check(managing || store.status === 'approved', 'NOT_FOUND', 'Restaurant not found.');
    return { store: { ...(await kitchenView(store, managing)), ...(managing ? { dispatchPoint: store.dispatchPoint } : {}), reviewNote: managing ? store.reviewNote : undefined }, menu: menuView((await repository.menu(id)).filter((item) => managing || item.available)) };
  }
  async function roleFor(user, order) {
    if (user.role === 'admin') return 'admin';
    if (order.customerId === user.id) return 'customer';
    if ((await member(user, order.storeId))) return 'store';
    if (order.courierId === user.id) return 'courier';
    return null;
  }
  async function orderView(user, order) {
    check(order, 'NOT_FOUND', 'Order not found.');
    const role = (await roleFor(user, order)); check(role, 'NOT_FOUND', 'Order not found.');
    const active = !EATS_TERMINAL.includes(order.status), pickup = order.snapshot.fulfillment === 'pickup';
    const reveal = role === 'store' || role === 'admin' || active && (role === 'courier' || role === 'customer' && pickup && order.status === 'ready');
    const source = order.collectionPoint ? { ...order.snapshot, restaurant: { ...order.snapshot.restaurant, address: order.collectionPoint } } : order.snapshot;
    const { address, ...snapshot } = (await snapshotView(source, reveal));
    return { id: order.id, status: order.status, version: order.version, ...snapshot, role, actions: eatsActions(order, role),
      address: role === 'store' ? { areaId: address.areaId } : address,
      needsCollectionPoint: role === 'store' && order.status === 'preparing' && (await privateKitchen(order.snapshot.restaurant)) && !order.snapshot.restaurant.address && !order.collectionPoint,
      customerName: (await getAccount(order.customerId)).name, courier: order.courier,
      ...(active && !pickup && role === 'store' && ['ready', 'assigned'].includes(order.status) ? { pickupPin: order.pickupPin } : {}),
      ...(active && role === 'customer' && (pickup ? order.status === 'ready' : ['picked_up', 'arrived'].includes(order.status)) ? { deliveryPin: order.deliveryPin } : {}),
      pinBlockedUntil: role === 'courier' || pickup && role === 'store' ? order.pinBlockedUntil : undefined,
      events: order.events, createdAt: order.createdAt, updatedAt: order.updatedAt };
  }
  async function quoteView(user, id) {
    const quote = (await repository.quote(id)); check(quote?.customerId === user.id, 'NOT_FOUND', 'Checkout quote not found.');
    return { id: quote.id, ...(await snapshotView(quote.snapshot)), expiresAt: quote.expiresAt };
  }
  async function list(user, scope = 'customer', beforeId = null) {
    user = (await actor(user)); check(['customer', 'store', 'courier'].includes(scope), 'INVALID_SCOPE', 'Choose customer, store or courier orders.');
    let id = user.id;
    if (scope === 'store') { id = (await repository.membership(user.id))?.storeId; check(id, 'FORBIDDEN', 'Create a store first.'); }
    if (scope === 'courier') check(hasCapability(user, 'driver'), 'FORBIDDEN', 'A driver profile is required.');
    const before = beforeId ? (await repository.order(beforeId)) : null;
    if (beforeId) {
      check(before && ({ customer: before.customerId, store: before.storeId, courier: before.courierId })[scope] === id, 'INVALID_CURSOR', 'Invalid orders cursor.');
    }
    const rows = (await repository.orders(id, scope, before)), orders = rows.slice(0, 50);
    return { orders: (await asyncMap(orders, async (o) => (await orderView(user, o)))), nextBefore: rows.length > 50 ? orders.at(-1).id : null };
  }
  function courierEligible(user) {
    requireEligibleDriver(user);
    check(['motorcycle', 'standard', 'suv', 'van'].includes(user.driver.vehicle.category ?? 'standard'), 'FORBIDDEN', 'Food deliveries require an approved motorcycle, car, SUV or van.');
  }
  async function work(user) {
    user = (await actor(user));
    check(hasCapability(user, 'driver'), 'FORBIDDEN', 'A driver profile is required.');
    const current = (await asyncMap((await repository.activeCourier(user.id)), async (o) => (await orderView(user, o))));
    const position = (await availabilityFor(user.id, clock()));
    const eligible = user.driver?.eligibility?.eligible && ['motorcycle', 'standard', 'suv', 'van'].includes(user.driver.vehicle.category ?? 'standard');
    const available = eligible && position && !(await hasOtherWork(user.id)) && !current.length ? (await asyncMap((await repository.ready(position, EATS_DISPATCH_RADIUS_METERS, user.id)), async (o) => ({ id: o.id, version: o.version, restaurant: (await kitchenView(o.snapshot.restaurant)), deliveryArea: area(o.snapshot.address.areaId),
        deliveryFeeKobo: o.snapshot.totals.deliveryFeeKobo, createdAt: o.createdAt, isDemo: true }))) : [];
    return { current, available, online: Boolean(position), eligible: Boolean(eligible), isDemo: true };
  }
  async function project(user, result, replayed) {
    if (result.failure) check(false, result.failure.code, result.failure.message);
    if (result.orderIds) return { orders: (await asyncMap(result.orderIds, async (id) => (await orderView(user, (await repository.order(id)))))), nextBefore: null, checkoutId: result.checkoutId, replayed };
    if (result.checkoutId) return { checkout: (await checkoutView(user, result.checkoutId)), replayed };
    if (result.orderId) return { order: (await orderView(user, (await repository.order(result.orderId)))), replayed };
    if (result.quoteId) return { quote: (await quoteView(user, result.quoteId)), replayed };
    check(user.role === 'admin' || (await member(user, result.storeId)), 'FORBIDDEN', 'Your store access changed.');
    return { ...(await storeView(user, result.storeId)), replayed };
  }
  function checkedTotal(quotes) {
    try { return mealTotals(quotes); } catch (error) { check(false, 'INVALID_CART', error.message); }
  }
  async function checkoutRecord(user, id) {
    const checkout = (await repository.checkout(identifier(id))); check(checkout?.customerId === user.id, 'NOT_FOUND', 'Meal checkout not found.'); return checkout;
  }
  async function checkoutView(user, id) {
    const checkout = (await checkoutRecord(user, id)), quotes = (await asyncMap(checkout.quoteIds, async (quoteId) => (await quoteView(user, quoteId))));
    return { id, quotes, totals: checkedTotal(quotes), expiresAt: Math.min(...quotes.map((q) => q.expiresAt)) };
  }
  async function makeQuote(user, data, now) {
    requireRole(user, 'customer'); const store = (await storeRecord(data?.storeId));
    check(store.status === 'approved' && store.isOpen, 'STORE_UNAVAILABLE', 'This kitchen is not accepting orders.');
    check(data.fulfillment === 'pickup' || dispatchReady(store), 'STORE_UNAVAILABLE', 'This kitchen needs a saved pickup location before it can offer courier delivery.');
    check(!(await member(user, store.id)), 'FORBIDDEN', 'Use a separate customer account to test orders from your store.');
    const snapshot = checkedBasket(store, (await repository.menu(store.id)), data), quoteId = tokens.id();
    (await repository.createQuote({ id: quoteId, customerId: user.id, storeId: store.id, storeVersion: store.version, snapshot, expiresAt: now + 600_000 }));
    return quoteId;
  }
  async function placeQuote(user, quoteId, now) {
    requireRole(user, 'customer'); const q = (await repository.quote(identifier(quoteId)));
    check(q?.customerId === user.id, 'NOT_FOUND', 'Checkout quote not found.');
    check(!q.orderId, 'QUOTE_USED', 'This checkout already created an order. Open My orders.');
    check(q.expiresAt > now, 'QUOTE_EXPIRED', 'This checkout expired. Review your cart again.');
    const store = (await storeRecord(q.storeId));
    check(store.status === 'approved' && store.isOpen, 'STORE_UNAVAILABLE', 'This kitchen stopped accepting orders.');
    check(q.snapshot.fulfillment === 'pickup' || dispatchReady(store), 'STORE_UNAVAILABLE', 'This kitchen needs a saved pickup location before it can offer courier delivery.');
    check(store.version === q.storeVersion, 'MENU_CHANGED', 'The menu or fees changed. Review a fresh checkout before ordering.');
    check(!(await member(user, store.id)), 'FORBIDDEN', 'You cannot order from your own store.');
    (await reserve(q.snapshot, store, now));
    const orderId = tokens.id();
    (await repository.createOrder({ id: orderId, storeId: store.id, customerId: user.id, snapshot: q.snapshot, dispatchPoint: q.snapshot.fulfillment === 'pickup' ? null : store.dispatchPoint,
      pickupPin: tokens.pickupPin(), deliveryPin: tokens.pickupPin(), events: [{ status: 'placed', at: now }], createdAt: now, updatedAt: now }));
    (await repository.bindQuote(q.id, orderId)); return orderId;
  }
  async function command(user, action, id, data, key, normalisedPhoto = null) {
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const fingerprint = tokens.digest(canonical({ action, id, data }));
    let replayed = false;
    const result = (await unitOfWork(async () => {
      user = (await actor(user));
      const previous = (await repository.command(user.id, key));
      if (previous) { check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another action.'); replayed = true; return previous.result; }
      const now = clock(); let result;
      if (action === 'store-create') {
        requireRole(user, 'customer'); fields(data, ['details']);
        check(!(await repository.membership(user.id)), 'STORE_EXISTS', 'Your account already has a store. Open My store to manage it.');
        const storeId = tokens.id(); (await repository.createStore({ id: storeId, details: storeDetails(data.details) }, user.id, now)); result = { storeId };
      } else if (['store-save', 'menu-save', 'store-open', 'store-review'].includes(action)) {
        const store = action === 'store-review' ? (await storeRecord(id)) : (await ownStore(user, id));
        if (action === 'store-review') requireRole(user, 'admin');
        const allowed = { 'store-save': ['details'], 'menu-save': ['itemId', 'item'], 'store-open': ['isOpen'], 'store-review': ['decision', 'reason', 'reference'] }[action];
        fields(data, ['expectedVersion', ...allowed]); version(store, data.expectedVersion);
        if (action === 'store-save') {
          const next = storeDetails(data.details, store);
          check(next.sellerType !== 'home_kitchen' || (await repository.menu(store.id)).every((i) => !i.available || i.portionsRemaining != null), 'INVALID_MENU', 'Set batch quantities for available menu items before switching to a home kitchen.');
          if (['name', 'address', 'areaId', 'cuisine', 'sellerType', 'pickupEnabled', 'deliveryEnabled'].some((field) => next[field] !== store[field])
            || canonical(next.dispatchPoint) !== canonical(store.dispatchPoint)) { store.status = 'pending'; store.isOpen = false; store.reviewNote = 'Store details changed. A new review is required.'; }
          Object.assign(store, next);
        } else if (action === 'menu-save') {
          const old = data.itemId !== null ? (await repository.menuItem(identifier(data.itemId))) : null;
          check(data.itemId === null || old?.storeId === store.id, 'NOT_FOUND', 'Menu item not found.');
          check(old || (await repository.menu(store.id)).length < 100, 'INVALID_MENU', 'A store can have up to 100 menu items.');
          const { photo, photoId: requestedPhoto, ...details } = data.item;
          const item = menuDetails(details, store, old ?? {});
          let photoId = requestedPhoto === undefined ? old?.photoId ?? null : requestedPhoto;
          if (photo) {
            check(normalisedPhoto, 'INVALID_PHOTO', 'Upload a valid meal photo.');
            photoId = tokens.id(); (await repository.savePhoto(photoId, store.id, normalisedPhoto, now));
          } else if (photoId !== null) check((await repository.photo(identifier(photoId)))?.storeId === store.id, 'NOT_FOUND', 'Meal photo not found.');
          (await repository.saveMenu(old?.id ?? tokens.id(), store.id, { ...item, photoId, batchId: tokens.id() }));
          if (old && (photo || requestedPhoto !== undefined)) (await repository.removeMenuPhoto(old.id));
          (await repository.prunePhotos(store.id));
        } else if (action === 'store-open') {
          check(typeof data.isOpen === 'boolean', 'INVALID_STORE', 'Choose open or closed.');
          check(!data.isOpen || store.status === 'approved', 'STORE_UNAVAILABLE', 'The store needs administrator approval before opening.');
          check(!data.isOpen || store.deliveryEnabled === false || dispatchReady(store), 'STORE_UNAVAILABLE', 'Save a private pickup location before opening for delivery, or offer customer pickup only.');
          check(!data.isOpen || (await repository.menu(store.id)).some(foodAvailable), 'INVALID_MENU', 'Add an available menu item before opening.');
          store.isOpen = data.isOpen;
        } else {
          check(['approved', 'suspended'].includes(data.decision), 'INVALID_REVIEW', 'Approve or suspend the store.');
          check(!(await member(user, store.id)), 'FORBIDDEN', 'You cannot review your own store.');
          const reference = label(data.reference, 'Manual review reference', 5, 160);
          store.reviewNote = label(data.reason, 'Review reason', 10, 500);
          check(data.decision !== 'approved' || (await repository.menu(store.id)).some(foodAvailable), 'INVALID_MENU', 'The store needs an available menu item before approval.');
          store.status = data.decision; store.isOpen = false;
          (await repository.review(store.id, user.id, data.decision, store.reviewNote, reference, now));
        }
        store.version++; store.updatedAt = now; (await repository.saveStore(store)); result = { storeId: store.id };
      } else if (action === 'quote') {
        result = { quoteId: (await makeQuote(user, data, now)) };
      } else if (action === 'place') {
        fields(data, ['quoteId']); result = { orderId: (await placeQuote(user, data.quoteId, now)) };
      } else if (action === 'meal-quote') {
        requireRole(user, 'customer'); fields(data, ['groups', 'address', 'instructions']);
        check(Array.isArray(data.groups) && data.groups.length > 0 && data.groups.length <= MEAL_LIMITS.kitchens, 'INVALID_CART', 'Choose dishes from 1–5 kitchens.');
        const ids = new Set(); let lines = 0;
        for (const group of data.groups) {
          fields(group, ['storeId', 'expectedVersion', 'items']);
          check(!ids.has(group.storeId) && Array.isArray(group.items), 'INVALID_CART', 'Combine each kitchen into one order.');
          ids.add(group.storeId); lines += group.items.length;
        }
        check(lines > 0 && lines <= MEAL_LIMITS.lines, 'INVALID_CART', 'Choose up to 20 different dishes.');
        const quoteIds = (await asyncMap(data.groups, async (group) => (await makeQuote(user, { ...group, address: data.address, instructions: data.instructions, fulfillment: 'delivery' }, now))));
        checkedTotal((await asyncMap(quoteIds, async (quoteId) => (await repository.quote(quoteId)).snapshot)));
        const checkoutId = tokens.id(); (await repository.createCheckout(checkoutId, user.id, quoteIds, now)); result = { checkoutId };
      } else if (action === 'meal-place') {
        requireRole(user, 'customer'); fields(data, ['checkoutId']); const checkout = (await checkoutRecord(user, data.checkoutId));
        // Every kitchen reservation, order, quote binding and retry record commits together.
        result = { checkoutId: checkout.id, orderIds: (await asyncMap(checkout.quoteIds, async (quoteId) => (await placeQuote(user, quoteId, now)))) };
      } else {
        const order = (await repository.order(id)); check(order, 'NOT_FOUND', 'Order not found.');
        const role = action === 'claim' ? 'courier' : (await roleFor(user, order));
        check(role, 'NOT_FOUND', 'Order not found.');
        const required = ['expectedVersion', ...(['pickup', 'deliver', 'complete_pickup'].includes(action) ? ['pin'] : ['cancel', 'reject'].includes(action) ? ['reason'] : [])];
        fields(data, [...required, ...(action === 'ready' ? ['collectionPoint'] : [])], required);
        version(order, data.expectedVersion);
        check(eatsActions(order, role).includes(action), 'ORDER_CLOSED', 'This action is no longer available. Refresh your order.');
        if (action === 'ready' && (await privateKitchen(order.snapshot.restaurant))) {
          const point = data.collectionPoint ?? order.collectionPoint ?? order.snapshot.restaurant.address;
          (await repository.saveCollectionPoint(order.id, label(point, 'Private collection point for this order', 8, 240)));
        }
        if (action === 'claim') {
          courierEligible(user);
          check(order.customerId !== user.id && !(await member(user, order.storeId)), 'FORBIDDEN', 'You cannot deliver your own order or your store’s order.');
          check(!(await hasOtherWork(user.id)) && !(await repository.hasWork(user.id)), 'DRIVER_BUSY', 'Finish your current journey or food delivery first.');
          const position = (await availabilityFor(user.id, now));
          check(position, 'DRIVER_OFFLINE', 'Go online in Work before taking a food delivery.');
          const point = position.mode === 'gps' ? (await repository.orderDispatchPoint(order.id)) : null;
          check(position.mode === 'sample' ? position.areaId === order.snapshot.restaurant.areaId
            : point && distanceMeters(position.position, point) <= EATS_DISPATCH_RADIUS_METERS,
          'OUTSIDE_MATCH_AREA', 'Go online within 10 km of this kitchen’s saved pickup location.');
          order.courierId = user.id; order.courier = { id: user.id, name: user.name, vehicle: user.driver.vehicle }; (await onClaim(user.id, now));
        }
        if (['pickup', 'deliver', 'complete_pickup'].includes(action)) {
          if (action === 'pickup') courierEligible(user);
          check(typeof data.pin === 'string' && /^\d{6}$/.test(data.pin), 'INVALID_PIN_FORMAT', 'Enter the six-digit handover code.');
          check(!order.pinBlockedUntil || order.pinBlockedUntil <= now, 'DELIVERY_PIN_LOCKED', 'Too many incorrect codes. Wait five minutes and try again.');
          if (!tokens.equal(data.pin, action === 'pickup' ? order.pickupPin : order.deliveryPin)) {
            order.pinFailures = (order.pinBlockedUntil ? 0 : order.pinFailures) + 1;
            order.pinBlockedUntil = order.pinFailures >= 5 ? now + 300_000 : null;
            order.version++; order.updatedAt = now; (await repository.saveOrder(order));
            result = { failure: { code: 'INVALID_PIN', message: 'That handover code is incorrect. Check it with the restaurant or customer.' } };
          } else { order.pinFailures = 0; order.pinBlockedUntil = null; if (action === 'pickup') order.pickupPin = null; }
        }
        if (!result) {
          if (['cancel', 'reject'].includes(action)) (await release(order, now));
          order.status = ({ accept: 'accepted', prepare: 'preparing', ready: 'ready', claim: 'assigned', pickup: 'picked_up', arrive: 'arrived', deliver: 'delivered', complete_pickup: 'delivered', cancel: 'cancelled', reject: 'rejected' })[action];
          const event = { status: order.status, at: now };
          if (['cancel', 'reject'].includes(action)) event.reason = label(data.reason, 'Reason', 5, 240);
          order.events.push(event); order.updatedAt = now; order.version++;
          if (EATS_TERMINAL.includes(order.status)) { order.pickupPin = order.deliveryPin = null; order.pinBlockedUntil = null; }
          (await repository.saveOrder(order)); result = { orderId: order.id };
        }
      }
      (await audit.record(user.id, `eats.${action}`, result.orderId ?? result.storeId ?? result.quoteId ?? result.checkoutId ?? id, now));
      (await repository.saveCommand(user.id, key, fingerprint, result, now)); return result;
    }));
    return (await project(user, result, replayed));
  }
  async function photoCommand(user, id, data, key, reauthenticate) {
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    fields(data, ['expectedVersion', 'itemId', 'image']);
    id = identifier(id); const itemId = identifier(data.itemId);
    user = (await actor(user)); const owned = (await ownStore(user, id));
    const fingerprint = tokens.digest(canonical({ action: 'photo-save', id, data }));
    const prior = (await repository.command(user.id, key));
    if (prior) { check(prior.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another action.'); return (await project(user, prior.result, true)); }
    version(owned, data.expectedVersion);
    const content = data.image === null ? null : await photoCodec.normalize(data.image);
    const fresh = (await reauthenticate()); check(fresh?.id === user.id, 'UNAUTHENTICATED', 'Sign in again to save the photo.'); user = fresh;
    let replayed = false;
    const result = (await unitOfWork(async () => {
      user = (await actor(user));
      const previous = (await repository.command(user.id, key));
      if (previous) { check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another action.'); replayed = true; return previous.result; }
      const store = (await ownStore(user, id)), item = (await repository.menuItem(itemId));
      version(store, data.expectedVersion);
      check(item?.storeId === store.id, 'NOT_FOUND', 'Menu item not found.');
      const current = (await repository.menuPhoto(itemId));
      if (content) {
        const total = (await repository.photoBytes(store.id)) - (current?.content.length ?? 0) + content.length;
        check(total <= 30 * 1024 * 1024, 'PHOTO_STORAGE_FULL', 'This store has reached its menu photo limit.');
        (await repository.saveMenuPhoto(itemId, store.id, content, store.version + 1));
      } else (await repository.removeMenuPhoto(itemId));
      const { id: menuId, storeId, ...details } = item;
      const photoId = content ? tokens.id() : null;
      if (content) (await repository.savePhoto(photoId, store.id, content.toString('base64'), clock()));
      (await repository.saveMenu(menuId, storeId, { ...details, photoId }));
      (await repository.prunePhotos(store.id));
      store.version++; store.updatedAt = clock(); (await repository.saveStore(store));
      const saved = { storeId: store.id };
      (await audit.record(user.id, content ? 'eats.photo.saved' : 'eats.photo.removed', itemId, store.updatedAt));
      (await repository.saveCommand(user.id, key, fingerprint, saved, store.updatedAt));
      return saved;
    }));
    return (await project(user, result, replayed));
  }
  async function image(user, itemId) {
    user = (await actor(user));
    const item = (await repository.menuItem(identifier(itemId)));
    const canonicalPhoto = item?.photoId ? (await repository.photo(item.photoId)) : null;
    const photo = canonicalPhoto ? { storeId: canonicalPhoto.storeId, content: Buffer.from(canonicalPhoto.base64, 'base64') } : (await repository.menuPhoto(itemId));
    check(item && photo && photo.storeId === item.storeId, 'NOT_FOUND', 'Food photo not found.');
    const store = (await repository.store(item.storeId));
    check(store && (user.role === 'admin' || (await member(user, store.id)) || store.status === 'approved' && item.available),
      'NOT_FOUND', 'Food photo not found.');
    return { content: Buffer.from(photo.content), mimeType: 'image/jpeg' };
  }
  return Object.freeze({ command, photoCommand, image, work, orders: list,
    async foods(user, query = {}) {
      user = (await actor(user)); area(query.areaId);
      const q = label(query.q ?? '', 'Food search', 0, 200), offset = Number(query.offset ?? 0);
      check(Number.isSafeInteger(offset) && offset >= 0 && offset <= 20_000, 'INVALID_CURSOR', 'Choose a valid food page.');
      const stores = (await repository.stores(false, { deliveryAreaId: query.areaId, openOnly: true, excludeMemberId: user.id }));
      const options = (await asyncFlatMap(stores, async ({ reviewNote, ...s }) => (await asyncMap(menuView((await repository.menu(s.id))).filter(foodAvailable), async (item) => ({ store: (await kitchenView(s)), item })))));
      const matches = matchMeals(options, q);
      return { foods: matches.slice(offset, offset + 60), foodCount: matches.length, nextOffset: offset + 60 < matches.length ? offset + 60 : null, area: area(query.areaId) };
    },
    async saveMenu(user, id, data, key, reauthenticate) {
      user = (await actor(user)); (await ownStore(user, id));
      check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
      fields(data, ['expectedVersion', 'itemId', 'item']);
      fields(data.item, ['name', 'description', 'category', 'priceKobo', 'available', 'portionsRemaining', 'allergens', 'photoId', 'photo'], ['name', 'description', 'category', 'priceKobo', 'available']);
      check(data.item.photo === undefined || data.item.photo !== null && typeof data.item.photo === 'object' && !Array.isArray(data.item.photo), 'INVALID_PHOTO', 'Choose a valid meal photo.');
      check(!data.item.photo || data.item.photoId == null, 'INVALID_PHOTO', 'Upload a photo or choose a saved one.');
      const previous = (await repository.command(user.id, key));
      let photo = null;
      if (!previous && data.item.photo) {
        version((await storeRecord(id)), data.expectedVersion);
        photo = await normalisePhoto(data.item.photo);
        const fresh = (await reauthenticate()); check(fresh?.id === user.id, 'UNAUTHENTICATED', 'Sign in again to save the photo.'); user = fresh;
      }
      return (await command(user, 'menu-save', id, data, key, photo));
    },
    async photo(user, id) {
      user = (await actor(user)); const photo = (await repository.photo(identifier(id))); check(photo, 'NOT_FOUND', 'Meal photo not found.');
      const store = (await storeRecord(photo.storeId));
      check((store.status === 'approved' || (await member(user, store.id)) || user.role === 'admin') && (await asyncSome((await repository.menu(store.id)), async (item) => item.photoId === id && (item.available || (await member(user, store.id)) || user.role === 'admin'))), 'NOT_FOUND', 'Meal photo not found.');
      return { photo: { id, mimeType: 'image/jpeg', base64: photo.base64 } };
    },
    async catalog(user, query = {}) {
      user = (await actor(user));
      if (query.areaId) area(query.areaId);
      if (query.deliveryAreaId) area(query.deliveryAreaId);
      const candidates = (await repository.stores(false, { areaId: query.areaId || null, deliveryAreaId: query.deliveryAreaId || null, openOnly: query.openOnly === 'true', fulfillment: query.fulfillment ?? '' }));
      const search = String(query.q ?? '').trim().toLowerCase();
      const stores = (await asyncFilter(discoverKitchens(candidates, { ...query, q: '', openOnly: query.openOnly === 'true', fulfillment: query.fulfillment ?? '' }), async (s) => !search || `${s.name} ${s.cuisine} ${s.description}`.toLowerCase().includes(search) || (await repository.menu(s.id)).some((i) => foodAvailable(i) && `${i.name} ${i.description} ${i.category}`.toLowerCase().includes(search))));
      const restaurants = (await asyncMap(stores, async ({ reviewNote, ...s }) => (await kitchenView(s))));
      const q = String(query.q ?? '').trim().toLowerCase();
      const dishes = (await asyncFlatMap(restaurants, async (seller) => menuView((await repository.menu(seller.id))).filter(foodAvailable)
        .filter((item) => !q || `${item.name} ${item.description} ${item.category} ${seller.name}`.toLowerCase().includes(q))
        .map((item) => ({ ...item, seller })))).slice(0, 60);
      return { restaurants, dishes, areas: LEGACY_FOOD_AREAS, isDemo: true };
    },
    restaurant: async (user, id) => (await storeView((await actor(user)), id)),
    order: async (user, id) => ({ order: (await orderView((await actor(user)), (await repository.order(id)))) }),
    async mine(user) { user = (await actor(user)); const membership = (await repository.membership(user.id)); return membership ? { ...(await storeView(user, membership.storeId)), areas: LEGACY_FOOD_AREAS } : { store: null, menu: [], areas: LEGACY_FOOD_AREAS }; },
    async reviewList(user) { user = (await actor(user)); requireRole(user, 'admin'); return { stores: (await repository.stores(true)) }; },
  });
}
