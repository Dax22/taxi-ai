import { EATS_TERMINAL, eatsActions, foodAvailable, discoverKitchens, isPrivateKitchen } from '../../../../../packages/shared/src/eats.mjs';
import { matchMeals, mealTotals, MEAL_LIMITS } from '../../../../../packages/shared/src/eats-meals.mjs';
import { DEMO_AREAS } from '../../../../../packages/shared/src/demo-booking.mjs';
import { hasCapability, requireEligibleDriver, requireRole } from '../../shared/policies.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { check } from '../../shared/errors.mjs';
import { canonical, version, storeDetails, menuDetails, checkedBasket, area } from './domain.mjs';

/** Stores and food orders own their state; other work is checked through injected ports. */
export function createEatsService({ repository, getAccount, hasOtherWork, availabilityFor, onClaim, tokens, unitOfWork, audit, clock, normalisePhoto }) {
  const actor = (user) => { const fresh = getAccount(user?.id); check(fresh, 'UNAUTHENTICATED', 'Sign in to continue.'); return fresh; };
  const identifier = (id) => { check(typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id), 'INVALID_ID', 'Choose a valid record.'); return id; };
  const storeRecord = (id) => { const value = repository.store(identifier(id)); check(value, 'NOT_FOUND', 'Restaurant not found.'); return value; };
  const member = (user, id) => repository.membership(user.id)?.storeId === id;
  const ownStore = (user, id) => { check(member(user, id), 'FORBIDDEN', 'Only this store’s owner can manage it.'); return storeRecord(id); };
  // Honour privacy in both historical snapshots and the current profile after a seller-type change.
  const privateKitchen = (kitchen) => isPrivateKitchen(kitchen.sellerType) || isPrivateKitchen(repository.store(kitchen.id)?.sellerType);
  const kitchenView = (kitchen, reveal = false) => {
    const hidden = privateKitchen(kitchen) && (!reveal || !kitchen.address);
    return { ...kitchen, address: hidden ? '' : kitchen.address, addressHidden: hidden };
  };
  const menuView = (items) => items.map(({ batchId, ...item }) => item);
  const snapshotView = (snapshot, reveal = false) => ({ ...snapshot, fulfillment: snapshot.fulfillment ?? 'delivery',
    restaurant: kitchenView(snapshot.restaurant, reveal), lines: menuView(snapshot.lines) });
  // Inventory and order writes share the command transaction, including retries and rollback.
  function reserve(snapshot, store, now) {
    let changed = false;
    for (const line of snapshot.lines) {
      const item = repository.menuItem(line.itemId);
      check(item && foodAvailable(item) && (item.portionsRemaining == null || item.portionsRemaining >= line.quantity), 'MENU_CHANGED', 'A batch sold out. Refresh the menu and review your quantities.');
      if (item.portionsRemaining != null) { const { id, storeId, ...details } = item; details.portionsRemaining -= line.quantity; repository.saveMenu(id, storeId, details); changed = true; }
    }
    if (changed) { store.version++; store.updatedAt = now; repository.saveStore(store); }
  }
  function release(order, now) {
    if (!['placed', 'accepted'].includes(order.status)) return;
    let changed = false;
    for (const line of order.snapshot.lines) {
      const item = repository.menuItem(line.itemId);
      // Editing/restocking an item starts a new batch; an old cancellation cannot inflate it.
      if (line.batchId && item?.batchId === line.batchId && item.portionsRemaining != null) {
        const { id, storeId, ...details } = item; details.portionsRemaining += line.quantity;
        repository.saveMenu(id, storeId, details); changed = true;
      }
    }
    if (changed) { const store = storeRecord(order.storeId); store.version++; store.updatedAt = now; repository.saveStore(store); }
  }
  function storeView(user, id) {
    const store = storeRecord(id), managing = user.role === 'admin' || member(user, id);
    check(managing || store.status === 'approved', 'NOT_FOUND', 'Restaurant not found.');
    return { store: { ...kitchenView(store, managing), reviewNote: managing ? store.reviewNote : undefined }, menu: menuView(repository.menu(id).filter((item) => managing || item.available)) };
  }
  function roleFor(user, order) {
    if (user.role === 'admin') return 'admin';
    if (order.customerId === user.id) return 'customer';
    if (member(user, order.storeId)) return 'store';
    if (order.courierId === user.id) return 'courier';
    return null;
  }
  function orderView(user, order) {
    check(order, 'NOT_FOUND', 'Order not found.');
    const role = roleFor(user, order); check(role, 'NOT_FOUND', 'Order not found.');
    const active = !EATS_TERMINAL.includes(order.status), pickup = order.snapshot.fulfillment === 'pickup';
    const reveal = role === 'store' || role === 'admin' || active && (role === 'courier' || role === 'customer' && pickup && order.status === 'ready');
    const source = order.collectionPoint ? { ...order.snapshot, restaurant: { ...order.snapshot.restaurant, address: order.collectionPoint } } : order.snapshot;
    const { address, ...snapshot } = snapshotView(source, reveal);
    return { id: order.id, status: order.status, version: order.version, ...snapshot, role, actions: eatsActions(order, role),
      address: role === 'store' ? { areaId: address.areaId } : address,
      needsCollectionPoint: role === 'store' && order.status === 'preparing' && privateKitchen(order.snapshot.restaurant) && !order.snapshot.restaurant.address && !order.collectionPoint,
      customerName: getAccount(order.customerId).name, courier: order.courier,
      ...(active && !pickup && role === 'store' && ['ready', 'assigned'].includes(order.status) ? { pickupPin: order.pickupPin } : {}),
      ...(active && role === 'customer' && (pickup ? order.status === 'ready' : ['picked_up', 'arrived'].includes(order.status)) ? { deliveryPin: order.deliveryPin } : {}),
      pinBlockedUntil: role === 'courier' || pickup && role === 'store' ? order.pinBlockedUntil : undefined,
      events: order.events, createdAt: order.createdAt, updatedAt: order.updatedAt };
  }
  function quoteView(user, id) {
    const quote = repository.quote(id); check(quote?.customerId === user.id, 'NOT_FOUND', 'Checkout quote not found.');
    return { id: quote.id, ...snapshotView(quote.snapshot), expiresAt: quote.expiresAt };
  }
  function list(user, scope = 'customer', beforeId = null) {
    user = actor(user); check(['customer', 'store', 'courier'].includes(scope), 'INVALID_SCOPE', 'Choose customer, store or courier orders.');
    let id = user.id;
    if (scope === 'store') { id = repository.membership(user.id)?.storeId; check(id, 'FORBIDDEN', 'Create a store first.'); }
    if (scope === 'courier') check(hasCapability(user, 'driver'), 'FORBIDDEN', 'A driver profile is required.');
    const before = beforeId ? repository.order(beforeId) : null;
    if (beforeId) {
      check(before && ({ customer: before.customerId, store: before.storeId, courier: before.courierId })[scope] === id, 'INVALID_CURSOR', 'Invalid orders cursor.');
    }
    const rows = repository.orders(id, scope, before), orders = rows.slice(0, 50);
    return { orders: orders.map((o) => orderView(user, o)), nextBefore: rows.length > 50 ? orders.at(-1).id : null };
  }
  function courierEligible(user) {
    requireEligibleDriver(user);
    check(['motorcycle', 'standard', 'suv', 'van'].includes(user.driver.vehicle.category ?? 'standard'), 'FORBIDDEN', 'Food deliveries require an approved motorcycle, car, SUV or van.');
  }
  function work(user) {
    user = actor(user);
    check(hasCapability(user, 'driver'), 'FORBIDDEN', 'A driver profile is required.');
    const current = repository.activeCourier(user.id).map((o) => orderView(user, o));
    const position = availabilityFor(user.id, clock());
    const eligible = user.driver?.eligibility?.eligible && ['motorcycle', 'standard', 'suv', 'van'].includes(user.driver.vehicle.category ?? 'standard');
    const available = eligible && position && !hasOtherWork(user.id) && !current.length ? repository.ready()
      .filter((o) => o.customerId !== user.id && !member(user, o.storeId) && (position.mode !== 'sample' || o.snapshot.restaurant.areaId === position.areaId))
      .map((o) => ({ id: o.id, version: o.version, restaurant: kitchenView(o.snapshot.restaurant), deliveryArea: area(o.snapshot.address.areaId),
        deliveryFeeKobo: o.snapshot.totals.deliveryFeeKobo, createdAt: o.createdAt, isDemo: true })) : [];
    return { current, available, online: Boolean(position), eligible: Boolean(eligible), isDemo: true };
  }
  function project(user, result, replayed) {
    if (result.failure) check(false, result.failure.code, result.failure.message);
    if (result.orderIds) return { orders: result.orderIds.map((id) => orderView(user, repository.order(id))), nextBefore: null, checkoutId: result.checkoutId, replayed };
    if (result.checkoutId) return { checkout: checkoutView(user, result.checkoutId), replayed };
    if (result.orderId) return { order: orderView(user, repository.order(result.orderId)), replayed };
    if (result.quoteId) return { quote: quoteView(user, result.quoteId), replayed };
    check(user.role === 'admin' || member(user, result.storeId), 'FORBIDDEN', 'Your store access changed.');
    return { ...storeView(user, result.storeId), replayed };
  }
  function checkedTotal(quotes) {
    try { return mealTotals(quotes); } catch (error) { check(false, 'INVALID_CART', error.message); }
  }
  function checkoutRecord(user, id) {
    const checkout = repository.checkout(identifier(id)); check(checkout?.customerId === user.id, 'NOT_FOUND', 'Meal checkout not found.'); return checkout;
  }
  function checkoutView(user, id) {
    const checkout = checkoutRecord(user, id), quotes = checkout.quoteIds.map((quoteId) => quoteView(user, quoteId));
    return { id, quotes, totals: checkedTotal(quotes), expiresAt: Math.min(...quotes.map((q) => q.expiresAt)) };
  }
  function makeQuote(user, data, now) {
    requireRole(user, 'customer'); const store = storeRecord(data?.storeId);
    check(store.status === 'approved' && store.isOpen, 'STORE_UNAVAILABLE', 'This kitchen is not accepting orders.');
    check(!member(user, store.id), 'FORBIDDEN', 'Use a separate customer account to test orders from your store.');
    const snapshot = checkedBasket(store, repository.menu(store.id), data), quoteId = tokens.id();
    repository.createQuote({ id: quoteId, customerId: user.id, storeId: store.id, storeVersion: store.version, snapshot, expiresAt: now + 600_000 });
    return quoteId;
  }
  function placeQuote(user, quoteId, now) {
    requireRole(user, 'customer'); const q = repository.quote(identifier(quoteId));
    check(q?.customerId === user.id, 'NOT_FOUND', 'Checkout quote not found.');
    check(!q.orderId, 'QUOTE_USED', 'This checkout already created an order. Open My orders.');
    check(q.expiresAt > now, 'QUOTE_EXPIRED', 'This checkout expired. Review your cart again.');
    const store = storeRecord(q.storeId);
    check(store.status === 'approved' && store.isOpen, 'STORE_UNAVAILABLE', 'This kitchen stopped accepting orders.');
    check(store.version === q.storeVersion, 'MENU_CHANGED', 'The menu or fees changed. Review a fresh checkout before ordering.');
    check(!member(user, store.id), 'FORBIDDEN', 'You cannot order from your own store.');
    reserve(q.snapshot, store, now);
    const orderId = tokens.id();
    repository.createOrder({ id: orderId, storeId: store.id, customerId: user.id, snapshot: q.snapshot,
      pickupPin: tokens.pickupPin(), deliveryPin: tokens.pickupPin(), events: [{ status: 'placed', at: now }], createdAt: now, updatedAt: now });
    repository.bindQuote(q.id, orderId); return orderId;
  }
  function command(user, action, id, data, key, normalisedPhoto = null) {
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const fingerprint = tokens.digest(canonical({ action, id, data }));
    let replayed = false;
    const result = unitOfWork(() => {
      user = actor(user);
      const previous = repository.command(user.id, key);
      if (previous) { check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another action.'); replayed = true; return previous.result; }
      const now = clock(); let result;
      if (action === 'store-create') {
        requireRole(user, 'customer'); fields(data, ['details']);
        check(!repository.membership(user.id), 'STORE_EXISTS', 'Your account already has a store. Open My store to manage it.');
        const storeId = tokens.id(); repository.createStore({ id: storeId, details: storeDetails(data.details) }, user.id, now); result = { storeId };
      } else if (['store-save', 'menu-save', 'store-open', 'store-review'].includes(action)) {
        const store = action === 'store-review' ? storeRecord(id) : ownStore(user, id);
        if (action === 'store-review') requireRole(user, 'admin');
        const allowed = { 'store-save': ['details'], 'menu-save': ['itemId', 'item'], 'store-open': ['isOpen'], 'store-review': ['decision', 'reason', 'reference'] }[action];
        fields(data, ['expectedVersion', ...allowed]); version(store, data.expectedVersion);
        if (action === 'store-save') {
          const next = storeDetails(data.details, store);
          check(next.sellerType !== 'home_kitchen' || repository.menu(store.id).every((i) => !i.available || i.portionsRemaining != null), 'INVALID_MENU', 'Set batch quantities for available menu items before switching to a home kitchen.');
          if (['name', 'address', 'areaId', 'cuisine', 'sellerType', 'pickupEnabled'].some((field) => next[field] !== store[field])) { store.status = 'pending'; store.isOpen = false; store.reviewNote = 'Store details changed. A new review is required.'; }
          Object.assign(store, next);
        } else if (action === 'menu-save') {
          const old = data.itemId !== null ? repository.menuItem(identifier(data.itemId)) : null;
          check(data.itemId === null || old?.storeId === store.id, 'NOT_FOUND', 'Menu item not found.');
          check(old || repository.menu(store.id).length < 100, 'INVALID_MENU', 'A store can have up to 100 menu items.');
          const { photo, photoId: requestedPhoto, ...details } = data.item;
          const item = menuDetails(details, store, old ?? {});
          let photoId = requestedPhoto === undefined ? old?.photoId ?? null : requestedPhoto;
          if (photo) {
            check(normalisedPhoto, 'INVALID_PHOTO', 'Upload a valid meal photo.');
            photoId = tokens.id(); repository.savePhoto(photoId, store.id, normalisedPhoto, now);
          } else if (photoId !== null) check(repository.photo(identifier(photoId))?.storeId === store.id, 'NOT_FOUND', 'Meal photo not found.');
          repository.saveMenu(old?.id ?? tokens.id(), store.id, { ...item, photoId, batchId: tokens.id() });
          repository.prunePhotos(store.id);
        } else if (action === 'store-open') {
          check(typeof data.isOpen === 'boolean', 'INVALID_STORE', 'Choose open or closed.');
          check(!data.isOpen || store.status === 'approved', 'STORE_UNAVAILABLE', 'The store needs administrator approval before opening.');
          check(!data.isOpen || repository.menu(store.id).some(foodAvailable), 'INVALID_MENU', 'Add an available menu item before opening.');
          store.isOpen = data.isOpen;
        } else {
          check(['approved', 'suspended'].includes(data.decision), 'INVALID_REVIEW', 'Approve or suspend the store.');
          check(!member(user, store.id), 'FORBIDDEN', 'You cannot review your own store.');
          const reference = label(data.reference, 'Manual review reference', 5, 160);
          store.reviewNote = label(data.reason, 'Review reason', 10, 500);
          check(data.decision !== 'approved' || repository.menu(store.id).some(foodAvailable), 'INVALID_MENU', 'The store needs an available menu item before approval.');
          store.status = data.decision; store.isOpen = false;
          repository.review(store.id, user.id, data.decision, store.reviewNote, reference, now);
        }
        store.version++; store.updatedAt = now; repository.saveStore(store); result = { storeId: store.id };
      } else if (action === 'quote') {
        result = { quoteId: makeQuote(user, data, now) };
      } else if (action === 'place') {
        fields(data, ['quoteId']); result = { orderId: placeQuote(user, data.quoteId, now) };
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
        const quoteIds = data.groups.map((group) => makeQuote(user, { ...group, address: data.address, instructions: data.instructions, fulfillment: 'delivery' }, now));
        checkedTotal(quoteIds.map((quoteId) => repository.quote(quoteId).snapshot));
        const checkoutId = tokens.id(); repository.createCheckout(checkoutId, user.id, quoteIds, now); result = { checkoutId };
      } else if (action === 'meal-place') {
        requireRole(user, 'customer'); fields(data, ['checkoutId']); const checkout = checkoutRecord(user, data.checkoutId);
        // Every kitchen reservation, order, quote binding and retry record commits together.
        result = { checkoutId: checkout.id, orderIds: checkout.quoteIds.map((quoteId) => placeQuote(user, quoteId, now)) };
      } else {
        const order = repository.order(id); check(order, 'NOT_FOUND', 'Order not found.');
        const role = action === 'claim' ? 'courier' : roleFor(user, order);
        check(role, 'NOT_FOUND', 'Order not found.');
        const required = ['expectedVersion', ...(['pickup', 'deliver', 'complete_pickup'].includes(action) ? ['pin'] : ['cancel', 'reject'].includes(action) ? ['reason'] : [])];
        fields(data, [...required, ...(action === 'ready' ? ['collectionPoint'] : [])], required);
        version(order, data.expectedVersion);
        check(eatsActions(order, role).includes(action), 'ORDER_CLOSED', 'This action is no longer available. Refresh your order.');
        if (action === 'ready' && privateKitchen(order.snapshot.restaurant)) {
          const point = data.collectionPoint ?? order.collectionPoint ?? order.snapshot.restaurant.address;
          repository.saveCollectionPoint(order.id, label(point, 'Private collection point for this order', 8, 240));
        }
        if (action === 'claim') {
          courierEligible(user);
          check(order.customerId !== user.id && !member(user, order.storeId), 'FORBIDDEN', 'You cannot deliver your own order or your store’s order.');
          check(!hasOtherWork(user.id) && !repository.hasWork(user.id), 'DRIVER_BUSY', 'Finish your current journey or food delivery first.');
          const position = availabilityFor(user.id, now);
          check(position, 'DRIVER_OFFLINE', 'Go online in Work before taking a food delivery.');
          check(position.mode !== 'sample' || position.areaId === order.snapshot.restaurant.areaId, 'OUTSIDE_MATCH_AREA', 'Go online in the restaurant’s pickup area.');
          order.courierId = user.id; order.courier = { id: user.id, name: user.name, vehicle: user.driver.vehicle }; onClaim(user.id, now);
        }
        if (['pickup', 'deliver', 'complete_pickup'].includes(action)) {
          if (action === 'pickup') courierEligible(user);
          check(typeof data.pin === 'string' && /^\d{6}$/.test(data.pin), 'INVALID_PIN_FORMAT', 'Enter the six-digit handover code.');
          check(!order.pinBlockedUntil || order.pinBlockedUntil <= now, 'DELIVERY_PIN_LOCKED', 'Too many incorrect codes. Wait five minutes and try again.');
          if (!tokens.equal(data.pin, action === 'pickup' ? order.pickupPin : order.deliveryPin)) {
            order.pinFailures = (order.pinBlockedUntil ? 0 : order.pinFailures) + 1;
            order.pinBlockedUntil = order.pinFailures >= 5 ? now + 300_000 : null;
            order.version++; order.updatedAt = now; repository.saveOrder(order);
            result = { failure: { code: 'INVALID_PIN', message: 'That handover code is incorrect. Check it with the restaurant or customer.' } };
          } else { order.pinFailures = 0; order.pinBlockedUntil = null; if (action === 'pickup') order.pickupPin = null; }
        }
        if (!result) {
          if (['cancel', 'reject'].includes(action)) release(order, now);
          order.status = ({ accept: 'accepted', prepare: 'preparing', ready: 'ready', claim: 'assigned', pickup: 'picked_up', arrive: 'arrived', deliver: 'delivered', complete_pickup: 'delivered', cancel: 'cancelled', reject: 'rejected' })[action];
          const event = { status: order.status, at: now };
          if (['cancel', 'reject'].includes(action)) event.reason = label(data.reason, 'Reason', 5, 240);
          order.events.push(event); order.updatedAt = now; order.version++;
          if (EATS_TERMINAL.includes(order.status)) { order.pickupPin = order.deliveryPin = null; order.pinBlockedUntil = null; }
          repository.saveOrder(order); result = { orderId: order.id };
        }
      }
      audit.record(user.id, `eats.${action}`, result.orderId ?? result.storeId ?? result.quoteId ?? result.checkoutId ?? id, now);
      repository.saveCommand(user.id, key, fingerprint, result, now); return result;
    });
    return project(user, result, replayed);
  }
  return Object.freeze({ command, work, orders: list,
    foods(user, query = {}) {
      user = actor(user); area(query.areaId);
      const q = label(query.q ?? '', 'Food search', 0, 200), offset = Number(query.offset ?? 0);
      check(Number.isSafeInteger(offset) && offset >= 0 && offset <= 20_000, 'INVALID_CURSOR', 'Choose a valid food page.');
      const stores = repository.stores().filter((s) => s.isOpen && s.deliveryEnabled !== false && !member(user, s.id) && (!s.deliveryAreaIds || s.deliveryAreaIds.includes(query.areaId)));
      const options = stores.flatMap(({ reviewNote, ...s }) => menuView(repository.menu(s.id)).filter(foodAvailable).map((item) => ({ store: kitchenView(s), item })));
      const matches = matchMeals(options, q);
      return { foods: matches.slice(offset, offset + 60), foodCount: matches.length, nextOffset: offset + 60 < matches.length ? offset + 60 : null, area: area(query.areaId) };
    },
    async saveMenu(user, id, data, key, reauthenticate) {
      user = actor(user); ownStore(user, id);
      check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
      fields(data, ['expectedVersion', 'itemId', 'item']);
      fields(data.item, ['name', 'description', 'category', 'priceKobo', 'available', 'portionsRemaining', 'allergens', 'photoId', 'photo'], ['name', 'description', 'category', 'priceKobo', 'available']);
      check(data.item.photo === undefined || data.item.photo !== null && typeof data.item.photo === 'object' && !Array.isArray(data.item.photo), 'INVALID_PHOTO', 'Choose a valid meal photo.');
      check(!data.item.photo || data.item.photoId == null, 'INVALID_PHOTO', 'Upload a photo or choose a saved one.');
      const previous = repository.command(user.id, key);
      let photo = null;
      if (!previous && data.item.photo) {
        version(storeRecord(id), data.expectedVersion);
        photo = await normalisePhoto(data.item.photo);
        const fresh = reauthenticate(); check(fresh?.id === user.id, 'UNAUTHENTICATED', 'Sign in again to save the photo.'); user = fresh;
      }
      return command(user, 'menu-save', id, data, key, photo);
    },
    photo(user, id) {
      user = actor(user); const photo = repository.photo(identifier(id)); check(photo, 'NOT_FOUND', 'Meal photo not found.');
      const store = storeRecord(photo.storeId);
      check((store.status === 'approved' || member(user, store.id) || user.role === 'admin') && repository.menu(store.id).some((item) => item.photoId === id && (item.available || member(user, store.id) || user.role === 'admin')), 'NOT_FOUND', 'Meal photo not found.');
      return { photo: { id, mimeType: 'image/jpeg', base64: photo.base64 } };
    },
    catalog(user, query = {}) {
      user = actor(user);
      const stores = discoverKitchens(repository.stores(), { ...query, q: String(query.q ?? ''), openOnly: query.openOnly === 'true', fulfillment: query.fulfillment ?? '' });
      return { restaurants: stores.map(({ reviewNote, ...s }) => kitchenView(s)), areas: DEMO_AREAS, isDemo: true };
    },
    restaurant: (user, id) => storeView(actor(user), id),
    order: (user, id) => ({ order: orderView(actor(user), repository.order(id)) }),
    mine(user) { user = actor(user); const membership = repository.membership(user.id); return membership ? { ...storeView(user, membership.storeId), areas: DEMO_AREAS } : { store: null, menu: [], areas: DEMO_AREAS }; },
    reviewList(user) { user = actor(user); requireRole(user, 'admin'); return { stores: repository.stores(true) }; },
  });
}
