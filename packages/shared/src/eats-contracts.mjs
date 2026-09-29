import { EATS_STATUS, EATS_CUISINES, EATS_SELLERS, eatsTotals } from './eats.mjs';
import { mealTotals } from './eats-meals.mjs';
import { insideNigeria } from './locations.mjs';
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const string = (v) => typeof v === 'string';
const id = (v) => string(v) && /^[a-f0-9-]{36}$/.test(v);
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
function valid(value) { if (!value) throw new Error('Taxi Ai Eats returned an incompatible response. Refresh and try again.'); }
function seller(s) { valid((s.sellerType === undefined || Object.hasOwn(EATS_SELLERS, s.sellerType)) && (s.addressHidden === undefined || typeof s.addressHidden === 'boolean')); valid(!s.addressHidden || s.address === ''); }
function store(s) {
  valid(object(s) && id(s.id) && integer(s.version) && ['pending', 'approved', 'suspended'].includes(s.status) && typeof s.isOpen === 'boolean');
  valid(['name','description','address','areaId'].every((key) => string(s[key])) && EATS_CUISINES.includes(s.cuisine));
  seller(s); valid(['deliveryEnabled', 'pickupEnabled'].every((k) => s[k] === undefined || typeof s[k] === 'boolean'));
  valid(s.deliveryAreaIds === undefined || Array.isArray(s.deliveryAreaIds) && s.deliveryAreaIds.length <= 50 && s.deliveryAreaIds.every(string));
  valid(s.dispatchPoint == null || object(s.dispatchPoint) && insideNigeria(s.dispatchPoint) && Object.keys(s.dispatchPoint).every((key) => ['lat', 'lng'].includes(key)));
  valid(s.coverPhotoId == null || id(s.coverPhotoId));
  valid(integer(s.prepMinutes) && integer(s.minimumKobo) && integer(s.deliveryFeeKobo));
}
function menu(m) { valid(Array.isArray(m) && m.length <= 100); for (const i of m) valid(object(i) && id(i.id) && string(i.name) && string(i.description) && string(i.category) && integer(i.priceKobo) && typeof i.available === 'boolean' && (i.portionsRemaining == null || integer(i.portionsRemaining) && i.portionsRemaining <= 1000) && (i.allergens === undefined || string(i.allergens)) && (i.photoId == null || id(i.photoId)) && (i.photoVersion == null || integer(i.photoVersion) && i.photoVersion > 0)); }
function snapshot(o) {
  valid(object(o) && id(o.id) && object(o.restaurant) && id(o.restaurant.id) && ['name','address','areaId'].every((k) => string(o.restaurant[k])));
  valid(!Object.hasOwn(o.restaurant, 'dispatchPoint'));
  seller(o.restaurant); valid(o.fulfillment === undefined || ['delivery', 'pickup'].includes(o.fulfillment));
  valid(object(o.address) && string(o.address.areaId) && (o.address.line === undefined || string(o.address.line)) && string(o.instructions));
  valid(o.recipient === undefined || object(o.recipient) && ['self', 'other'].includes(o.recipient.kind)
    && (o.recipient.kind === 'self' ? Object.keys(o.recipient).length === 1
      : string(o.recipient.name) && o.recipient.name.length >= 2 && string(o.recipient.phone) && /^\+234\d{10}$/.test(o.recipient.phone)));
  valid(o.isDemo === true && o.payment?.method === 'test' && o.payment.status === 'not_charged');
  valid(Array.isArray(o.lines) && o.lines.every((l) => object(l) && id(l.itemId) && string(l.name) && string(l.description)));
  const totals = eatsTotals(o.lines, o.totals?.deliveryFeeKobo);
  valid(o.fulfillment !== 'pickup' || totals.deliveryFeeKobo === 0);
  valid(Object.keys(totals).every((key) => totals[key] === o.totals[key]));
}
function order(o) {
  snapshot(o); valid(Object.hasOwn(EATS_STATUS, o.status) && integer(o.version) && ['customer','store','courier','admin'].includes(o.role));
  valid(Array.isArray(o.actions) && o.actions.every((a) => ['accept','reject','prepare','ready','claim','pickup','arrive','deliver','complete_pickup','cancel'].includes(a)));
  valid(string(o.customerName) && (o.courier === null || object(o.courier) && id(o.courier.id) && string(o.courier.name) && object(o.courier.vehicle) && string(o.courier.vehicle.plate)));
  valid(Array.isArray(o.events) && o.events.length <= 30 && o.events.every((e) => object(e) && Object.hasOwn(EATS_STATUS, e.status) && integer(e.at) && (e.reason === undefined || string(e.reason))));
  valid(integer(o.createdAt) && integer(o.updatedAt));
  valid(o.needsCollectionPoint === undefined || typeof o.needsCollectionPoint === 'boolean' && (!o.needsCollectionPoint || o.role === 'store'));
  for (const code of ['pickupPin', 'deliveryPin']) valid(o[code] === undefined || string(o[code]) && /^\d{6}$/.test(o[code]));
  valid(o.pickupPin === undefined || o.role === 'store'); valid(o.deliveryPin === undefined || o.role === 'customer');
}
/** Validate every Eats response before either client replaces a usable screen. */
export function readEatsResponse(body) {
  valid(object(body));
  let known = false;
  if (Object.hasOwn(body, 'foods')) {
    known = true; valid(Array.isArray(body.foods) && body.foods.length <= 60 && integer(body.foodCount) && body.foodCount <= 20_000 && body.foodCount >= body.foods.length && (body.nextOffset === null || integer(body.nextOffset) && body.nextOffset > 0 && body.nextOffset < body.foodCount));
    valid(object(body.area) && string(body.area.id) && string(body.area.name));
    for (const food of body.foods) { valid(object(food)); store(food.store); valid(!Object.hasOwn(food.store, 'dispatchPoint')); menu([food.item]); }
  }
  if (Object.hasOwn(body, 'checkout')) {
    known = true; const c = body.checkout;
    valid(object(c) && id(c.id) && Array.isArray(c.quotes) && c.quotes.length > 0 && c.quotes.length <= 5 && integer(c.expiresAt));
    c.quotes.forEach((q) => { snapshot(q); valid(integer(q.expiresAt) && q.fulfillment === 'delivery'); });
    valid(new Set(c.quotes.map((q) => q.restaurant.id)).size === c.quotes.length && c.expiresAt === Math.min(...c.quotes.map((q) => q.expiresAt)));
    const totals = mealTotals(c.quotes); valid(object(c.totals) && Object.keys(totals).every((key) => c.totals[key] === totals[key]));
  }
  if (Object.hasOwn(body, 'photo')) { known = true; const p = body.photo; valid(object(p) && id(p.id) && p.mimeType === 'image/jpeg' && string(p.base64) && p.base64.length > 0 && p.base64.length <= 1_398_104 && p.base64.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(p.base64)); }
  for (const key of ['restaurants', 'stores']) if (Object.hasOwn(body, key)) { known = true; valid(Array.isArray(body[key]) && body[key].length <= 200); body[key].forEach((s) => { store(s); if (key === 'restaurants') valid(!Object.hasOwn(s, 'dispatchPoint')); }); }
  if (Object.hasOwn(body, 'dishes')) { known = true; valid(Array.isArray(body.dishes) && body.dishes.length <= 60); for (const dish of body.dishes) { menu([dish]); store(dish.seller); valid(!Object.hasOwn(dish.seller, 'dispatchPoint')); } }
  if (Object.hasOwn(body, 'store')) { known = true; if (body.store !== null) store(body.store); menu(body.menu); }
  if (Object.hasOwn(body, 'quote')) { known = true; snapshot(body.quote); valid(integer(body.quote.expiresAt)); }
  if (Object.hasOwn(body, 'order')) { known = true; order(body.order); }
  if (Object.hasOwn(body, 'orders')) { known = true; valid(Array.isArray(body.orders) && body.orders.length <= 50 && (body.nextBefore === null || id(body.nextBefore))); body.orders.forEach(order); }
  if (Object.hasOwn(body, 'checkoutId')) valid(id(body.checkoutId) && Array.isArray(body.orders) && body.orders.length > 0 && body.orders.length <= 5 && new Set(body.orders.map((o) => o.restaurant.id)).size === body.orders.length);
  if (Object.hasOwn(body, 'current')) {
    known = true; valid(Array.isArray(body.current) && body.current.length <= 1); body.current.forEach(order);
    valid(typeof body.online === 'boolean' && typeof body.eligible === 'boolean' && body.isDemo === true && Array.isArray(body.available) && body.available.length <= 100);
    for (const j of body.available) valid(object(j) && id(j.id) && integer(j.version) && object(j.restaurant) && !Object.hasOwn(j.restaurant, 'dispatchPoint') && id(j.restaurant.id) && string(j.restaurant.name) && string(j.restaurant.address) && object(j.deliveryArea) && string(j.deliveryArea.name) && integer(j.deliveryFeeKobo));
  }
  if (body.areas !== undefined) valid(Array.isArray(body.areas) && body.areas.length <= 50 && body.areas.every((a) => object(a) && string(a.id) && string(a.name)));
  valid(known); return body;
}
