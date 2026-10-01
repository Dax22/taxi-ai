import { EATS_TERMINAL, EATS_DISPATCH_RADIUS_METERS, EATS_LEGACY_AREA_IDS, eatsActions, foodAvailable, discoverKitchens, isPrivateKitchen } from '../../../../../packages/shared/src/eats.mjs';
import { matchMeals, mealTotals, MEAL_LIMITS } from '../../../../../packages/shared/src/eats-meals.mjs';
import { LEGACY_FOOD_AREAS } from '../../../../../packages/shared/src/nigeria-areas.mjs';
import { distanceMeters } from '../../../../../packages/shared/src/locations.mjs';
import { hasCapability, requireEligibleDriver, requireRole } from '../../shared/policies.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { check } from '../../shared/errors.mjs';
import { canonical, version, storeDetails, menuDetails, checkedBasket, area, deliveryAddress, deliveryRecipient, deliveryPoint } from './domain.mjs';
import { asyncMap, asyncFlatMap, asyncSome, asyncFilter } from '../../shared/async-collections.mjs';
import { createEatsPayments, foodPaymentPending, foodPaymentView, FOOD_PAYMENT_RESERVATION_MS } from './payments.mjs';


/** Stores and food orders own their state; other work is checked through injected ports. */
export function createEatsService({ repository, getAccount, hasOtherWork, availabilityFor, onClaim, photoCodec, tokens, unitOfWork, audit, clock, normalisePhoto, resolveDeliveryLocation = async (point) => ({ point, line: '', areaId: null, attribution: '' }), deliveryMapSettings = () => ({ tiles: null, attribution: '' }), foodTracking = null, paymentsEnabled = false, onPaymentClosed = async () => {}, onDeliveryEvent = async () => {} }) {
  const actor = async (user) => { const fresh = (await getAccount(user?.id)); check(fresh, 'UNAUTHENTICATED', 'Sign in to continue.'); return fresh; };
  const identifier = (id) => { check(typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id), 'INVALID_ID', 'Choose a valid record.'); return id; };
  const storeRecord = async (id) => { const value = (await repository.store(identifier(id))); check(value, 'NOT_FOUND', 'Restaurant not found.'); return value; };
  const member = async (user, id) => (await repository.membership(user.id))?.storeId === id;
  const dispatchReady = (store) => Boolean(store.dispatchPoint) || EATS_LEGACY_AREA_IDS.includes(store.areaId);
  const ownStore = async (user, id) => { check((await member(user, id)), 'FORBIDDEN', 'Only this store’s owner can manage it.'); return (await storeRecord(id)); };
  // Honour privacy in both historical snapshots and the current profile after a seller-type change.
  const privateKitchen = async (kitchen) => isPrivateKitchen(kitchen.sellerType) || isPrivateKitchen((await repository.store(kitchen.id))?.sellerType);
  const publishedPhoto = (status) => ['approved', 'legacy-approved'].includes(status);
  const photoMetadata = ({ id, purpose, status, version, reviewNote }) => ({ id, purpose, status, version, reviewNote: reviewNote ?? '' });
  const kitchenView = async (kitchen, reveal = false) => {
    const current = await repository.store(kitchen.id);
    const hidden = (isPrivateKitchen(kitchen.sellerType) || isPrivateKitchen(current?.sellerType)) && (!reveal || !kitchen.address);
    const { dispatchPoint, assets, logoPhotoId, coverPhotoId, ...profile } = kitchen;
    const visible = (await repository.assets(kitchen.id)).filter((photo) => publishedPhoto(photo.status));
    return { ...profile, logoPhotoId: visible.find((photo) => photo.purpose === 'logo')?.id ?? null,
      coverPhotoId: visible.find((photo) => photo.purpose === 'cover')?.id ?? current?.coverPhotoId ?? null,
      town: area(kitchen.areaId).name, address: hidden ? '' : kitchen.address, addressHidden: hidden };
  };
  const menuView = (items, managing = false) => items.map(({ batchId, photoStatus, photoReviewNote, ...item }) => {
    if (!Object.hasOwn(item, 'photoId')) return item;
    const visible = Boolean(item.photoId && (managing || publishedPhoto(photoStatus)));
    return { ...item, photoId: visible ? item.photoId : null, photoVersion: visible ? item.photoVersion ?? null : null,
      ...(managing ? { photoStatus: photoStatus ?? null, photoReviewNote: photoReviewNote ?? '' } : {}) };
  });
  async function checkedPhotoStorage(storeId) {
    check((await repository.photoBytes(storeId)) <= 30 * 1024 * 1024, 'PHOTO_STORAGE_FULL', 'This store has reached its photo storage limit. Remove unused photos before uploading more.');
  }
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
  const paymentOrders = createEatsPayments({ repository, clock, release, onPaymentClosed });
  async function expireOrder(user, id) {
    const order = await repository.order(id);
    if (order && await roleFor(user, order) && order.snapshot.payment?.method === 'paystack' && order.snapshot.payment.status === 'pending'
      && order.snapshot.payment.expiresAt <= clock()) await unitOfWork(() => paymentOrders.expire(order.snapshot.payment.targetId));
  }
  async function storeView(user, id) {
    const store = (await storeRecord(id)), managing = user.role === 'admin' || (await member(user, id));
    check(managing || store.status === 'approved', 'NOT_FOUND', 'Restaurant not found.');
    const owned = await member(user, id), assets = await repository.assets(id);
    const selected = (purpose) => { const photo = assets.find((value) => value.purpose === purpose); return photo ? photoMetadata(photo) : null; };
    return { store: { ...(await kitchenView(store, managing)), ...(managing ? { dispatchPoint: store.dispatchPoint,
      assets: { logo: selected('logo'), cover: selected('cover'), ...(owned ? { menuReference: selected('menu_reference') } : {}) } } : {}),
      reviewNote: managing ? store.reviewNote : undefined }, menu: menuView((await repository.menu(id)).filter((item) => managing || item.available), managing) };
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
    const { address, recipient: savedRecipient, ...snapshot } = (await snapshotView(source, reveal));
    const customer = await getAccount(order.customerId), recipient = savedRecipient ?? deliveryRecipient(undefined, customer);
    const contactVisible = role === 'customer' || role === 'admin' || role === 'courier' && active;
    const { point, ...addressWithoutPoint } = address;
    return { id: order.id, status: order.status, version: order.version, ...snapshot, payment: foodPaymentView(snapshot.payment, role), role,
      actions: eatsActions(order, role).filter(action => !foodPaymentPending(order) || ['cancel', 'reject'].includes(action)),
      address: role === 'store' ? { areaId: address.areaId } : contactVisible ? address : addressWithoutPoint,
      recipient: contactVisible ? recipient : { kind: recipient.kind, name: recipient.name },
      needsCollectionPoint: role === 'store' && order.status === 'preparing' && (await privateKitchen(order.snapshot.restaurant)) && !order.snapshot.restaurant.address && !order.collectionPoint,
      customerName: customer.name, courier: order.courier,
      ...(active && !pickup && role === 'store' && ['ready', 'assigned'].includes(order.status) ? { pickupPin: order.pickupPin } : {}),
      ...(active && role === 'customer' && (pickup ? order.status === 'ready' : ['picked_up', 'arrived'].includes(order.status)) ? { deliveryPin: order.deliveryPin } : {}),
      pinBlockedUntil: role === 'courier' || pickup && role === 'store' ? order.pinBlockedUntil : undefined,
      events: order.events, createdAt: order.createdAt, updatedAt: order.updatedAt };
  }
  async function quoteView(user, id) {
    const quote = (await repository.quote(id)); check(quote?.customerId === user.id, 'NOT_FOUND', 'Checkout quote not found.');
    return { id: quote.id, ...(await snapshotView(quote.snapshot)), recipient: quote.snapshot.recipient ?? deliveryRecipient(undefined, user), expiresAt: quote.expiresAt };
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
    if (result.deliveryProfile) { requireRole(user, 'customer'); return { deliveryProfile: await repository.deliveryProfile(user.id), replayed }; }
    if (result.orderIds) {
      const orders = await asyncMap(result.orderIds, async id => orderView(user, await repository.order(id)));
      return { orders, nextBefore: null, checkoutId: result.checkoutId, ...(orders[0]?.payment.method === 'paystack' ? { payment: orders[0].payment } : {}), replayed };
    }
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
    const placedQuote = await repository.quote(checkout.quoteIds[0]), placed = placedQuote?.orderId ? await repository.order(placedQuote.orderId) : null;
    return { id, quotes, totals: checkedTotal(quotes), expiresAt: Math.min(...quotes.map((q) => q.expiresAt)),
      ...(placed?.snapshot.payment?.method === 'paystack' ? { payment: foodPaymentView(placed.snapshot.payment, 'customer') } : {}) };
  }
  async function makeQuote(user, data, now) {
    requireRole(user, 'customer'); const store = (await storeRecord(data?.storeId));
    check(store.status === 'approved' && store.isOpen, 'STORE_UNAVAILABLE', 'This kitchen is not accepting orders.');
    check(data.fulfillment === 'pickup' || dispatchReady(store), 'STORE_UNAVAILABLE', 'This kitchen needs a saved pickup location before it can offer courier delivery.');
    check(!(await member(user, store.id)), 'FORBIDDEN', 'Use a separate customer account to test orders from your store.');
    const snapshot = { ...checkedBasket(store, (await repository.menu(store.id)), data), recipient: deliveryRecipient(data.recipient, user) }, quoteId = tokens.id();
    (await repository.createQuote({ id: quoteId, customerId: user.id, storeId: store.id, storeVersion: store.version, snapshot, expiresAt: now + 600_000 }));
    return quoteId;
  }
  async function placeQuote(user, quoteId, now, paymentTargetId = null) {
    requireRole(user, 'customer'); const q = (await repository.quote(identifier(quoteId)));
    check(q?.customerId === user.id, 'NOT_FOUND', 'Checkout quote not found.');
    check(!q.orderId, 'QUOTE_USED', 'This checkout already created an order. Open My orders.');
    check(q.expiresAt > now, 'QUOTE_EXPIRED', 'This checkout expired. Review your cart again.');
    if (paymentsEnabled && !paymentTargetId) check(!(await repository.checkoutForQuote(user.id, q.id)), 'PAYMENT_NOT_READY', 'Place this combined checkout together so its kitchens share one payment.');
    const store = (await storeRecord(q.storeId));
    check(store.status === 'approved' && store.isOpen, 'STORE_UNAVAILABLE', 'This kitchen stopped accepting orders.');
    check(q.snapshot.fulfillment === 'pickup' || dispatchReady(store), 'STORE_UNAVAILABLE', 'This kitchen needs a saved pickup location before it can offer courier delivery.');
    check(store.version === q.storeVersion, 'MENU_CHANGED', 'The menu or fees changed. Review a fresh checkout before ordering.');
    check(!(await member(user, store.id)), 'FORBIDDEN', 'You cannot order from your own store.');
    (await reserve(q.snapshot, store, now));
    const orderId = tokens.id();
    const snapshot = paymentsEnabled ? { ...q.snapshot, payment: { method: 'paystack', status: 'pending', targetId: paymentTargetId ?? orderId, expiresAt: now + FOOD_PAYMENT_RESERVATION_MS } } : q.snapshot;
    (await repository.createOrder({ id: orderId, storeId: store.id, customerId: user.id, snapshot, dispatchPoint: q.snapshot.fulfillment === 'pickup' ? null : store.dispatchPoint,
      pickupPin: tokens.pickupPin(), deliveryPin: tokens.pickupPin(), events: [{ status: 'placed', at: now }], createdAt: now, updatedAt: now }));
    (await repository.bindQuote(q.id, orderId)); return orderId;
  }
  async function command(user, action, id, data, key, normalisedPhoto = null) {
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    const fingerprint = tokens.digest(canonical({ action, id, data }));
    if (id && ['accept', 'reject', 'prepare', 'ready', 'claim', 'pickup', 'arrive', 'deliver', 'complete_pickup', 'cancel'].includes(action)) {
      await expireOrder(await actor(user), id);
    }
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
            photoId = tokens.id(); (await repository.savePhoto(photoId, store.id, normalisedPhoto, now, 'dish', store.version + 1));
          } else if (photoId !== null) {
            const existing = await repository.photo(identifier(photoId));
            check(existing?.storeId === store.id && existing.purpose === 'dish' && old?.photoId === photoId, 'NOT_FOUND', 'Meal photo not found.');
          }
          (await repository.saveMenu(old?.id ?? tokens.id(), store.id, { ...item, photoId, batchId: tokens.id() }));
          if (old && (photo || requestedPhoto !== undefined)) (await repository.removeMenuPhoto(old.id));
          (await repository.prunePhotos(store.id));
          await checkedPhotoStorage(store.id);
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
        requireRole(user, 'customer'); fields(data, ['groups', 'address', 'instructions', 'recipient'], ['groups', 'address', 'instructions']);
        check(Array.isArray(data.groups) && data.groups.length > 0 && data.groups.length <= MEAL_LIMITS.kitchens, 'INVALID_CART', 'Choose dishes from 1–5 kitchens.');
        const ids = new Set(); let lines = 0;
        for (const group of data.groups) {
          fields(group, ['storeId', 'expectedVersion', 'items']);
          check(!ids.has(group.storeId) && Array.isArray(group.items), 'INVALID_CART', 'Combine each kitchen into one order.');
          ids.add(group.storeId); lines += group.items.length;
        }
        check(lines > 0 && lines <= MEAL_LIMITS.lines, 'INVALID_CART', 'Choose up to 20 different dishes.');
        const quoteIds = (await asyncMap(data.groups, async (group) => (await makeQuote(user, { ...group, address: data.address, instructions: data.instructions, recipient: data.recipient, fulfillment: 'delivery' }, now))));
        checkedTotal((await asyncMap(quoteIds, async (quoteId) => (await repository.quote(quoteId)).snapshot)));
        const checkoutId = tokens.id(); (await repository.createCheckout(checkoutId, user.id, quoteIds, now)); result = { checkoutId };
      } else if (action === 'meal-place') {
        requireRole(user, 'customer'); fields(data, ['checkoutId']); const checkout = (await checkoutRecord(user, data.checkoutId));
        // Every kitchen reservation, order, quote binding and retry record commits together.
        result = { checkoutId: checkout.id, orderIds: (await asyncMap(checkout.quoteIds, async (quoteId) => (await placeQuote(user, quoteId, now, checkout.id)))) };
      } else {
        const order = (await repository.order(id)); check(order, 'NOT_FOUND', 'Order not found.');
        const role = action === 'claim' ? 'courier' : (await roleFor(user, order));
        check(role, 'NOT_FOUND', 'Order not found.');
        const required = ['expectedVersion', ...(['pickup', 'deliver', 'complete_pickup'].includes(action) ? ['pin'] : ['cancel', 'reject'].includes(action) ? ['reason'] : [])];
        fields(data, [...required, ...(action === 'ready' ? ['collectionPoint'] : [])], required);
        version(order, data.expectedVersion);
        check(eatsActions(order, role).includes(action), 'ORDER_CLOSED', 'This action is no longer available. Refresh your order.');
        if (!['cancel', 'reject'].includes(action)) check(!foodPaymentPending(order), 'PAYMENT_REQUIRED', 'The customer must complete payment before this order can continue.');
        if (['pickup', 'arrive'].includes(action)) {
          check(await foodTracking?.freshPositionFor(user.id, order.id, now), 'LOCATION_REQUIRED', 'Turn on live delivery location and wait for a fresh GPS fix before continuing.');
        }
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
          if (['cancel', 'reject'].includes(action)) { await release(order, now); await paymentOrders.close(order, now); }
          order.status = ({ accept: 'accepted', prepare: 'preparing', ready: 'ready', claim: 'assigned', pickup: 'picked_up', arrive: 'arrived', deliver: 'delivered', complete_pickup: 'delivered', cancel: 'cancelled', reject: 'rejected' })[action];
          const event = { status: order.status, at: now };
          if (['cancel', 'reject'].includes(action)) event.reason = label(data.reason, 'Reason', 5, 240);
          order.events.push(event); order.updatedAt = now; order.version++;
          if (EATS_TERMINAL.includes(order.status)) { order.pickupPin = order.deliveryPin = null; order.pinBlockedUntil = null; }
          (await repository.saveOrder(order));
          if (order.snapshot.fulfillment !== 'pickup' && ['pickup', 'arrive', 'deliver'].includes(action)) {
            await onDeliveryEvent({ order, phase: order.status, eventKey: `food:${order.id}:${order.status}`, now });
          }
          if (EATS_TERMINAL.includes(order.status)) await foodTracking?.closeRide(order.id, now);
          result = { orderId: order.id };
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
      // Keep one normalized canonical copy. The item-image route remains compatible.
      await repository.removeMenuPhoto(itemId);
      const { id: menuId, storeId, ...details } = item;
      const photoId = content ? tokens.id() : null;
      if (content) (await repository.savePhoto(photoId, store.id, content.toString('base64'), clock(), 'dish', store.version + 1));
      (await repository.saveMenu(menuId, storeId, { ...details, photoId }));
      (await repository.prunePhotos(store.id));
      await checkedPhotoStorage(store.id);
      store.version++; store.updatedAt = clock(); (await repository.saveStore(store));
      const saved = { storeId: store.id };
      (await audit.record(user.id, content ? 'eats.photo.saved' : 'eats.photo.removed', itemId, store.updatedAt));
      (await repository.saveCommand(user.id, key, fingerprint, saved, store.updatedAt));
      return saved;
    }));
    return (await project(user, result, replayed));
  }
  async function readablePhoto(user, id) {
    const photo = await repository.photo(identifier(id));
    check(photo && await repository.attachedPhoto(id), 'NOT_FOUND', 'Photo not found.');
    const store = await storeRecord(photo.storeId), owned = await member(user, store.id);
    // A printed menu can contain a home address or phone number. It is an owner-only onboarding aid.
    if (photo.purpose === 'menu_reference') check(owned, 'NOT_FOUND', 'Photo not found.');
    else if (!owned && user.role !== 'admin') {
      check(store.status === 'approved' && publishedPhoto(photo.status), 'NOT_FOUND', 'Photo not found.');
      if (photo.purpose === 'dish') check((await repository.menu(store.id)).some((item) => item.photoId === id && item.available), 'NOT_FOUND', 'Photo not found.');
    }
    return photo;
  }
  async function image(user, itemId) {
    user = await actor(user);
    const item = await repository.menuItem(identifier(itemId));
    check(item?.photoId, 'NOT_FOUND', 'Food photo not found.');
    const photo = await readablePhoto(user, item.photoId);
    check(photo.purpose === 'dish' && photo.storeId === item.storeId, 'NOT_FOUND', 'Food photo not found.');
    return { content: Buffer.from(photo.base64, 'base64'), mimeType: 'image/jpeg' };
  }
  async function assetCommand(user, id, data, key, reauthenticate) {
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    fields(data, ['expectedVersion', 'purpose', 'image']);
    check(['logo', 'cover', 'menu_reference'].includes(data.purpose), 'INVALID_PHOTO', 'Choose a logo, cover photo or private menu reference.');
    id = identifier(id); user = await actor(user); const owned = await ownStore(user, id);
    const fingerprint = tokens.digest(canonical({ action: 'asset-save', id, data }));
    const prior = await repository.command(user.id, key);
    if (prior) { check(prior.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another action.'); return project(user, prior.result, true); }
    version(owned, data.expectedVersion);
    const content = data.image === null ? null : await photoCodec.normalize(data.image);
    const fresh = await reauthenticate(); check(fresh?.id === user.id, 'UNAUTHENTICATED', 'Sign in again to save the photo.'); user = fresh;
    let replayed = false;
    const result = await unitOfWork(async () => {
      user = await actor(user);
      const previous = await repository.command(user.id, key);
      if (previous) { check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another action.'); replayed = true; return previous.result; }
      const store = await ownStore(user, id); version(store, data.expectedVersion);
      const photoId = content ? tokens.id() : null, now = clock();
      if (content) await repository.savePhoto(photoId, store.id, content.toString('base64'), now, data.purpose, store.version + 1);
      await repository.saveAsset(store.id, data.purpose, photoId);
      await repository.prunePhotos(store.id); await checkedPhotoStorage(store.id);
      store.version++; store.updatedAt = now; await repository.saveStore(store);
      const result = { storeId: store.id };
      await audit.record(user.id, content ? 'eats.asset.saved' : 'eats.asset.removed', store.id, now);
      await repository.saveCommand(user.id, key, fingerprint, result, now);
      return result;
    });
    return project(user, result, replayed);
  }
  async function photoReview(user, id, data, key, reauthenticate) {
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    fields(data, ['expectedVersion', 'decision', 'reason']);
    check(['approved', 'rejected'].includes(data.decision), 'INVALID_REVIEW', 'Approve or reject the photo.');
    const reason = label(data.reason, 'Photo review reason', 10, 500);
    id = identifier(id); user = await actor(user); requireRole(user, 'admin');
    const fresh = await reauthenticate(); check(fresh?.id === user.id, 'UNAUTHENTICATED', 'Sign in again to review the photo.'); user = fresh;
    const fingerprint = tokens.digest(canonical({ action: 'photo-review', id, data }));
    let replayed = false;
    const result = await unitOfWork(async () => {
      user = await actor(user); requireRole(user, 'admin');
      const previous = await repository.command(user.id, key);
      if (previous) { check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another action.'); replayed = true; return previous.result; }
      const photo = await repository.photo(id);
      check(photo && photo.purpose !== 'menu_reference' && await repository.attachedPhoto(id), 'NOT_FOUND', 'Photo not found.');
      check(!(await member(user, photo.storeId)), 'FORBIDDEN', 'You cannot review your own store’s photo.');
      version(photo, data.expectedVersion); const now = clock();
      await repository.reviewPhoto(photo, user.id, data.decision, reason, now);
      await audit.record(user.id, `eats.photo.${data.decision}`, photo.id, now);
      const store = await storeRecord(photo.storeId), item = photo.purpose === 'dish' ? (await repository.menu(photo.storeId)).find((value) => value.photoId === photo.id) : null;
      const result = { photoReview: { ...photoMetadata({ ...photo, status: data.decision, version: photo.version + 1, reviewNote: reason }),
        storeId: store.id, storeName: store.name, itemId: item?.id ?? null, itemName: item?.name ?? null, createdAt: photo.createdAt } };
      await repository.saveCommand(user.id, key, fingerprint, result, now);
      return result;
    });
    return { ...result, replayed };
  }
  async function trackingContext(user, id) {
    user = await actor(user); const order = await repository.order(identifier(id));
    check(user.role !== 'admin' && order && (order.customerId === user.id || order.courierId === user.id), 'NOT_FOUND', 'Delivery tracking not found.');
    return { id: order.id, customerId: order.customerId, driverId: order.courierId, status: order.status };
  }
  const foodShare = (share) => {
    if (!share) return null;
    const { rideId, ...value } = share; return { ...value, orderId: rideId };
  };
  async function tracking(input, id) {
    check(foodTracking, 'LOCATION_CLOSED', 'Delivery tracking is unavailable.');
    const result = await foodTracking.tracking(input, identifier(id));
    const order = await repository.order(id);
    let share = foodShare(result.share);
    if (!result.isDriver && share?.position) {
      let visible = ['picked_up', 'arrived'].includes(order.status);
      if (visible && await privateKitchen(order.snapshot.restaurant)) {
        const pickup = await repository.orderDispatchPoint(id);
        visible = Boolean(pickup && distanceMeters(pickup, share.position) > 250);
      }
      // A live courier marker must not reveal a private kitchen's collection point.
      if (!visible) share = { ...share, position: null, updatedAt: null, stale: true };
    }
    return { orderId: result.rideId, isCourier: result.isDriver, canShare: result.canShare,
      required: result.isDriver && ['assigned', 'picked_up', 'arrived'].includes(order.status), share };
  }
  async function trackingCommand(input, action, id, data, key) {
    check(foodTracking, 'LOCATION_CLOSED', 'Delivery tracking is unavailable.');
    const result = action === 'position' ? await foodTracking.update(input, identifier(id), data)
      : await foodTracking.shareCommand(input, action, identifier(id), data, key);
    return { share: foodShare(result.share), replayed: result.replayed };
  }
  async function deliveryProfile(user) {
    user = await actor(user); requireRole(user, 'customer');
    return { deliveryProfile: await repository.deliveryProfile(user.id), deliverySettings: await deliveryMapSettings() };
  }
  async function saveDeliveryProfile(user, data, key, reauthenticate) {
    check(typeof key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY', 'A unique request key is required.');
    fields(data, ['expectedVersion', 'label', 'address']);
    check(['home', 'work'].includes(data.label), 'INVALID_ADDRESS', 'Choose Home or Work.');
    const address = data.address === null ? null : deliveryAddress(data.address);
    user = await actor(user); requireRole(user, 'customer');
    const fresh = await reauthenticate(); check(fresh?.id === user.id, 'UNAUTHENTICATED', 'Sign in again to save the delivery address.'); user = fresh;
    const fingerprint = tokens.digest(canonical({ action: 'delivery-profile-save', data }));
    let replayed = false;
    const result = await unitOfWork(async () => {
      user = await actor(user); requireRole(user, 'customer');
      const previous = await repository.command(user.id, key);
      if (previous) { check(previous.fingerprint === fingerprint, 'KEY_REUSED', 'This key belongs to another action.'); replayed = true; return previous.result; }
      const profile = await repository.deliveryProfile(user.id); version(profile, data.expectedVersion);
      const next = { version: profile.version + 1, addresses: { ...profile.addresses, [data.label]: address } }, now = clock();
      check(await repository.saveDeliveryProfile(user.id, next, profile.version, now), 'STALE_VERSION', 'Your saved addresses changed. Refresh and try again.');
      const result = { deliveryProfile: true };
      await audit.record(user.id, address ? 'eats.delivery-address.saved' : 'eats.delivery-address.removed', user.id, now);
      await repository.saveCommand(user.id, key, fingerprint, result, now);
      return result;
    });
    return project(user, result, replayed);
  }
  async function deliveryLocation(user, data, reauthenticate) {
    user = await actor(user); requireRole(user, 'customer');
    fields(data, ['lat', 'lng']); const point = deliveryPoint(data);
    const located = await resolveDeliveryLocation(point);
    const fresh = await reauthenticate(); check(fresh?.id === user.id, 'UNAUTHENTICATED', 'Sign in again to use this delivery location.');
    user = await actor(fresh); requireRole(user, 'customer');
    if (located.areaId !== null && located.areaId !== undefined) area(located.areaId);
    return { deliveryLocation: { point, line: label(located.line ?? '', 'Suggested delivery address', 0, 240), areaId: located.areaId ?? null,
      attribution: label(located.attribution ?? '', 'Map attribution', 0, 500) } };
  }
  return Object.freeze({ trackingContext, tracking, trackingCommand, deliveryProfile, saveDeliveryProfile, deliveryLocation, command, photoCommand, assetCommand, photoReview, image, work, orders: list,
    paymentContext: async (user, targetId) => paymentOrders.context(await actor(user), identifier(targetId)),
    applyPayment: paymentOrders.apply,
    async expirePendingPayments() {
      const targets = await repository.expiredPaymentTargets(clock(), 100);
      let expired = 0;
      for (const targetId of targets) if (await unitOfWork(() => paymentOrders.expire(targetId))) expired++;
      return { expired };
    },
    async photoReviewList(user, query = {}) {
      user = await actor(user); requireRole(user, 'admin');
      const status = query.status ?? 'pending';
      check(['pending', 'approved', 'rejected', 'legacy-approved'].includes(status), 'INVALID_REVIEW', 'Choose a valid photo review status.');
      const before = query.before ? await repository.photo(identifier(query.before)) : null;
      if (query.before) check(before && before.status === status && before.purpose !== 'menu_reference', 'INVALID_CURSOR', 'The review queue changed. Refresh the page.');
      const rows = await repository.photoQueue(status, before);
      return { photos: rows.slice(0, 50).map((photo) => ({ ...photo, reviewNote: photo.reviewNote ?? '' })), nextBefore: rows.length > 50 ? rows[49].id : null };
    },
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
      user = await actor(user); const photo = await readablePhoto(user, id);
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
    order: async (user, id) => { user = await actor(user); await expireOrder(user, id); return { order: await orderView(user, await repository.order(id)) }; },
    async mine(user) { user = (await actor(user)); const membership = (await repository.membership(user.id)); return membership ? { ...(await storeView(user, membership.storeId)), areas: LEGACY_FOOD_AREAS } : { store: null, menu: [], areas: LEGACY_FOOD_AREAS }; },
    async reviewList(user) { user = (await actor(user)); requireRole(user, 'admin'); return { stores: (await repository.stores(true)) }; },
  });
}
