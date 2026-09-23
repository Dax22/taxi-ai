import { EATS_TERMINAL, eatsActions } from '../../../../../packages/shared/src/eats.mjs';
import { DEMO_AREAS } from '../../../../../packages/shared/src/demo-booking.mjs';
import { hasCapability, requireEligibleDriver, requireRole } from '../../shared/policies.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { check } from '../../shared/errors.mjs';
import { canonical, version, storeDetails, menuDetails, checkedBasket, area } from './domain.mjs';

/** Stores and food orders own their state; other work is checked through injected ports. */
export function createEatsService({ repository, getAccount, hasOtherWork, availabilityFor, onClaim, photoCodec, tokens, unitOfWork, audit, clock }) {
  const actor = (user) => { const fresh = getAccount(user?.id); check(fresh, 'UNAUTHENTICATED', 'Sign in to continue.'); return fresh; };
  const identifier = (id) => { check(typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id), 'INVALID_ID', 'Choose a valid record.'); return id; };
  const storeRecord = (id) => { const value = repository.store(identifier(id)); check(value, 'NOT_FOUND', 'Restaurant not found.'); return value; };
  const member = (user, id) => repository.membership(user.id)?.storeId === id;
  const ownStore = (user, id) => { check(member(user, id), 'FORBIDDEN', 'Only this store’s owner can manage it.'); return storeRecord(id); };
  const publicStore = (store) => {
    const { address, reviewNote, ...visible } = store;
    return { ...visible, town: area(store.areaId).name, ...((store.sellerType ?? 'restaurant') === 'restaurant' ? { address } : {}) };
  };
  function storeView(user, id) {
    const store = storeRecord(id), managing = user.role === 'admin' || member(user, id);
    check(managing || store.status === 'approved', 'NOT_FOUND', 'Restaurant not found.');
    return { store: managing ? { ...store, town: area(store.areaId).name } : publicStore(store), menu: repository.menu(id).filter((item) => managing || item.available) };
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
    const active = !EATS_TERMINAL.includes(order.status), { address, ...snapshot } = order.snapshot;
    const restaurant = ['store','courier','admin'].includes(role)
      ? { ...snapshot.restaurant, address: repository.store(order.storeId).address } : snapshot.restaurant;
    return { id: order.id, status: order.status, version: order.version, ...snapshot, restaurant, role, actions: eatsActions(order, role),
      address: role === 'store' ? { areaId: address.areaId } : address,
      customerName: getAccount(order.customerId).name, courier: order.courier,
      ...(active && role === 'store' && ['ready', 'assigned'].includes(order.status) ? { pickupPin: order.pickupPin } : {}),
      ...(active && role === 'customer' && ['picked_up', 'arrived'].includes(order.status) ? { deliveryPin: order.deliveryPin } : {}),
      pinBlockedUntil: role === 'courier' ? order.pinBlockedUntil : undefined,
      events: order.events, createdAt: order.createdAt, updatedAt: order.updatedAt };
  }
  function quoteView(user, id) {
    const quote = repository.quote(id); check(quote?.customerId === user.id, 'NOT_FOUND', 'Checkout quote not found.');
    return { id: quote.id, ...quote.snapshot, expiresAt: quote.expiresAt };
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
      .map((o) => ({ id: o.id, version: o.version, restaurant: o.snapshot.restaurant, deliveryArea: area(o.snapshot.address.areaId),
        deliveryFeeKobo: o.snapshot.totals.deliveryFeeKobo, createdAt: o.createdAt, isDemo: true })) : [];
    return { current, available, online: Boolean(position), eligible: Boolean(eligible), isDemo: true };
  }
  function project(user, result, replayed) {
    if (result.failure) check(false, result.failure.code, result.failure.message);
    if (result.orderId) return { order: orderView(user, repository.order(result.orderId)), replayed };
    if (result.quoteId) return { quote: quoteView(user, result.quoteId), replayed };
    check(user.role === 'admin' || member(user, result.storeId), 'FORBIDDEN', 'Your store access changed.');
    return { ...storeView(user, result.storeId), replayed };
  }
  function command(user, action, id, data, key) {
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
          const next = storeDetails(data.details);
          if (['name', 'address', 'areaId', 'cuisine', 'sellerType'].some((field) => next[field] !== store[field])) { store.status = 'pending'; store.isOpen = false; store.reviewNote = 'Store details changed. A new review is required.'; }
          Object.assign(store, next);
        } else if (action === 'menu-save') {
          const item = menuDetails(data.item), old = data.itemId !== null ? repository.menuItem(identifier(data.itemId)) : null;
          check(data.itemId === null || old?.storeId === store.id, 'NOT_FOUND', 'Menu item not found.');
          check(old || repository.menu(store.id).length < 100, 'INVALID_MENU', 'A store can have up to 100 menu items.');
          repository.saveMenu(old?.id ?? tokens.id(), store.id, item);
        } else if (action === 'store-open') {
          check(typeof data.isOpen === 'boolean', 'INVALID_STORE', 'Choose open or closed.');
          check(!data.isOpen || store.status === 'approved', 'STORE_UNAVAILABLE', 'The store needs administrator approval before opening.');
          check(!data.isOpen || repository.menu(store.id).some((item) => item.available), 'INVALID_MENU', 'Add an available menu item before opening.');
          store.isOpen = data.isOpen;
        } else {
          check(['approved', 'suspended'].includes(data.decision), 'INVALID_REVIEW', 'Approve or suspend the store.');
          check(!member(user, store.id), 'FORBIDDEN', 'You cannot review your own store.');
          const reference = label(data.reference, 'Manual review reference', 5, 160);
          store.reviewNote = label(data.reason, 'Review reason', 10, 500);
          check(data.decision !== 'approved' || repository.menu(store.id).some((i) => i.available), 'INVALID_MENU', 'The store needs an available menu item before approval.');
          store.status = data.decision; store.isOpen = false;
          repository.review(store.id, user.id, data.decision, store.reviewNote, reference, now);
        }
        store.version++; store.updatedAt = now; repository.saveStore(store); result = { storeId: store.id };
      } else if (action === 'quote') {
        requireRole(user, 'customer'); fields(data, ['storeId', 'expectedVersion', 'items', 'address', 'instructions']); const store = storeRecord(data.storeId);
        check(store.status === 'approved' && store.isOpen, 'STORE_UNAVAILABLE', 'This restaurant is not accepting orders.');
        check(!member(user, store.id), 'FORBIDDEN', 'Use a separate customer account to test orders from your store.');
        const snapshot = checkedBasket(store, repository.menu(store.id), data), quoteId = tokens.id();
        repository.createQuote({ id: quoteId, customerId: user.id, storeId: store.id, storeVersion: store.version, snapshot, expiresAt: now + 600_000 }); result = { quoteId };
      } else if (action === 'place') {
        requireRole(user, 'customer'); fields(data, ['quoteId']); const q = repository.quote(identifier(data.quoteId));
        check(q?.customerId === user.id, 'NOT_FOUND', 'Checkout quote not found.');
        check(!q.orderId, 'QUOTE_USED', 'This checkout already created an order. Open My orders.');
        check(q.expiresAt > now, 'QUOTE_EXPIRED', 'This checkout expired. Review your cart again.');
        const store = storeRecord(q.storeId);
        check(store.status === 'approved' && store.isOpen, 'STORE_UNAVAILABLE', 'This restaurant stopped accepting orders.');
        check(store.version === q.storeVersion, 'MENU_CHANGED', 'The menu or fees changed. Review a fresh checkout before ordering.');
        check(!member(user, store.id), 'FORBIDDEN', 'You cannot order from your own store.');
        const orderId = tokens.id();
        repository.createOrder({ id: orderId, storeId: store.id, customerId: user.id, snapshot: q.snapshot,
          pickupPin: tokens.pickupPin(), deliveryPin: tokens.pickupPin(), events: [{ status: 'placed', at: now }], createdAt: now, updatedAt: now });
        repository.bindQuote(q.id, orderId); result = { orderId };
      } else {
        const order = repository.order(id); check(order, 'NOT_FOUND', 'Order not found.');
        const role = action === 'claim' ? 'courier' : roleFor(user, order);
        check(role, 'NOT_FOUND', 'Order not found.');
        fields(data, ['expectedVersion', ...(['pickup', 'deliver'].includes(action) ? ['pin'] : ['cancel', 'reject'].includes(action) ? ['reason'] : [])]);
        version(order, data.expectedVersion);
        check(eatsActions(order, role).includes(action), 'ORDER_CLOSED', 'This action is no longer available. Refresh your order.');
        if (action === 'claim') {
          courierEligible(user);
          check(order.customerId !== user.id && !member(user, order.storeId), 'FORBIDDEN', 'You cannot deliver your own order or your store’s order.');
          check(!hasOtherWork(user.id) && !repository.hasWork(user.id), 'DRIVER_BUSY', 'Finish your current journey or food delivery first.');
          const position = availabilityFor(user.id, now);
          check(position, 'DRIVER_OFFLINE', 'Go online in Work before taking a food delivery.');
          check(position.mode !== 'sample' || position.areaId === order.snapshot.restaurant.areaId, 'OUTSIDE_MATCH_AREA', 'Go online in the restaurant’s pickup area.');
          order.courierId = user.id; order.courier = { id: user.id, name: user.name, vehicle: user.driver.vehicle }; onClaim(user.id, now);
        }
        if (['pickup', 'deliver'].includes(action)) {
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
          order.status = ({ accept: 'accepted', prepare: 'preparing', ready: 'ready', claim: 'assigned', pickup: 'picked_up', arrive: 'arrived', deliver: 'delivered', cancel: 'cancelled', reject: 'rejected' })[action];
          const event = { status: order.status, at: now };
          if (['cancel', 'reject'].includes(action)) event.reason = label(data.reason, 'Reason', 5, 240);
          order.events.push(event); order.updatedAt = now; order.version++;
          if (EATS_TERMINAL.includes(order.status)) { order.pickupPin = order.deliveryPin = null; order.pinBlockedUntil = null; }
          repository.saveOrder(order); result = { orderId: order.id };
        }
      }
      audit.record(user.id, `eats.${action}`, result.orderId ?? result.storeId ?? result.quoteId ?? id, now);
      repository.saveCommand(user.id, key, fingerprint, result, now); return result;
    });
    return project(user, result, replayed);
  }
  async function photoCommand(user, id, data, key) {
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    fields(data, ['expectedVersion', 'itemId', 'image']);
    id = identifier(id); const itemId = identifier(data.itemId);
    user = actor(user); const owned = ownStore(user, id);
    const fingerprint = tokens.digest(canonical({ action: 'photo-save', id, data }));
    const prior = repository.command(user.id, key);
    if (prior) { check(prior.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another action.'); return project(user, prior.result, true); }
    version(owned, data.expectedVersion);
    const content = data.image === null ? null : await photoCodec.normalize(data.image);
    let replayed = false;
    const result = unitOfWork(() => {
      user = actor(user);
      const previous = repository.command(user.id, key);
      if (previous) { check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another action.'); replayed = true; return previous.result; }
      const store = ownStore(user, id), item = repository.menuItem(itemId);
      version(store, data.expectedVersion);
      check(item?.storeId === store.id, 'NOT_FOUND', 'Menu item not found.');
      const current = repository.photo(itemId);
      if (content) {
        const total = repository.photoBytes(store.id) - (current?.content.length ?? 0) + content.length;
        check(total <= 30 * 1024 * 1024, 'PHOTO_STORAGE_FULL', 'This store has reached its menu photo limit.');
        repository.savePhoto(itemId, store.id, content, store.version + 1);
      } else repository.removePhoto(itemId);
      store.version++; store.updatedAt = clock(); repository.saveStore(store);
      const saved = { storeId: store.id };
      audit.record(user.id, content ? 'eats.photo.saved' : 'eats.photo.removed', itemId, store.updatedAt);
      repository.saveCommand(user.id, key, fingerprint, saved, store.updatedAt);
      return saved;
    });
    return project(user, result, replayed);
  }
  function image(user, itemId) {
    user = actor(user);
    const item = repository.menuItem(identifier(itemId)), photo = repository.photo(itemId);
    check(item && photo && photo.storeId === item.storeId, 'NOT_FOUND', 'Food photo not found.');
    const store = repository.store(item.storeId);
    check(store && (user.role === 'admin' || member(user, store.id) || store.status === 'approved' && item.available),
      'NOT_FOUND', 'Food photo not found.');
    return { content: Buffer.from(photo.content), mimeType: 'image/jpeg' };
  }
  return Object.freeze({ command, photoCommand, image, work, orders: list,
    catalog(user, query = {}) {
      user = actor(user); const q = String(query.q ?? '').trim().toLowerCase().slice(0, 100);
      const stores = repository.stores().filter((s) => !query.cuisine || s.cuisine === query.cuisine);
      const matches = (value) => !q || value.toLowerCase().includes(q);
      const rows = stores.map((seller) => ({ seller: publicStore(seller), items: repository.menu(seller.id).filter((item) => item.available) }));
      const dishes = rows.flatMap(({ seller, items }) => items.filter((item) => matches(`${item.name} ${item.description} ${item.category} ${seller.name} ${seller.cuisine}`))
        .map((item) => ({ ...item, seller }))).slice(0, 60);
      const restaurants = rows.filter(({ seller, items }) => matches(`${seller.name} ${seller.cuisine} ${seller.description}`)
        || q && items.some((item) => matches(`${item.name} ${item.description} ${item.category}`))).map(({ seller }) => seller);
      return { restaurants, dishes, areas: DEMO_AREAS, isDemo: true };
    },
    restaurant: (user, id) => storeView(actor(user), id),
    order: (user, id) => ({ order: orderView(actor(user), repository.order(id)) }),
    mine(user) { user = actor(user); const membership = repository.membership(user.id); return membership ? { ...storeView(user, membership.storeId), areas: DEMO_AREAS } : { store: null, menu: [], areas: DEMO_AREAS }; },
    reviewList(user) { user = actor(user); requireRole(user, 'admin'); return { stores: repository.stores(true).map((store) => ({ ...store, town: area(store.areaId).name })) }; },
  });
}
