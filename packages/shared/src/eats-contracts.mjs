import { EATS_STATUS, EATS_CUISINES, eatsTotals } from './eats.mjs';
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const string = (v) => typeof v === 'string';
const id = (v) => string(v) && /^[a-f0-9-]{36}$/.test(v);
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
function valid(value) { if (!value) throw new Error('Taxi Ai Eats returned an incompatible response. Refresh and try again.'); }
function store(s) {
  valid(object(s) && id(s.id) && integer(s.version) && ['pending', 'approved', 'suspended'].includes(s.status) && typeof s.isOpen === 'boolean');
  valid(['restaurant','vendor','private_kitchen'].includes(s.sellerType ?? 'restaurant'));
  valid(['name','description','areaId'].every((key) => string(s[key])) && EATS_CUISINES.includes(s.cuisine));
  valid((s.sellerType ?? 'restaurant') === 'restaurant' ? string(s.address) : string(s.town) && (s.address === undefined || string(s.address)));
  valid(integer(s.prepMinutes) && integer(s.minimumKobo) && integer(s.deliveryFeeKobo));
}
function menu(m) { valid(Array.isArray(m) && m.length <= 100); for (const i of m) valid(object(i) && id(i.id) && string(i.name) && string(i.description) && string(i.category) && integer(i.priceKobo) && typeof i.available === 'boolean'
  && (i.photoVersion === undefined || i.photoVersion === null || integer(i.photoVersion) && i.photoVersion > 0)); }
function snapshot(o) {
  valid(object(o) && id(o.id) && object(o.restaurant) && id(o.restaurant.id) && ['name','areaId'].every((k) => string(o.restaurant[k])));
  valid((o.restaurant.sellerType ?? 'restaurant') === 'restaurant' ? string(o.restaurant.address) : string(o.restaurant.town) && (o.restaurant.address === undefined || string(o.restaurant.address)));
  valid(object(o.address) && string(o.address.areaId) && (o.address.line === undefined || string(o.address.line)) && string(o.instructions));
  valid(o.isDemo === true && o.payment?.method === 'test' && o.payment.status === 'not_charged');
  valid(Array.isArray(o.lines) && o.lines.every((l) => object(l) && id(l.itemId) && string(l.name) && string(l.description)));
  const totals = eatsTotals(o.lines, o.totals?.deliveryFeeKobo);
  valid(Object.keys(totals).every((key) => totals[key] === o.totals[key]));
}
function order(o) {
  snapshot(o); valid(Object.hasOwn(EATS_STATUS, o.status) && integer(o.version) && ['customer','store','courier','admin'].includes(o.role));
  valid(Array.isArray(o.actions) && o.actions.every((a) => ['accept','reject','prepare','ready','claim','pickup','arrive','deliver','cancel'].includes(a)));
  valid(string(o.customerName) && (o.courier === null || object(o.courier) && id(o.courier.id) && string(o.courier.name) && object(o.courier.vehicle) && string(o.courier.vehicle.plate)));
  valid(Array.isArray(o.events) && o.events.length <= 30 && o.events.every((e) => object(e) && Object.hasOwn(EATS_STATUS, e.status) && integer(e.at) && (e.reason === undefined || string(e.reason))));
  valid(integer(o.createdAt) && integer(o.updatedAt));
  for (const code of ['pickupPin', 'deliveryPin']) valid(o[code] === undefined || string(o[code]) && /^\d{6}$/.test(o[code]));
  valid(o.pickupPin === undefined || o.role === 'store'); valid(o.deliveryPin === undefined || o.role === 'customer');
}
/** Validate every Eats response before either client replaces a usable screen. */
export function readEatsResponse(body) {
  valid(object(body));
  let known = false;
  for (const key of ['restaurants', 'stores']) if (Object.hasOwn(body, key)) { known = true; valid(Array.isArray(body[key]) && body[key].length <= 200); body[key].forEach(store); }
  if (Object.hasOwn(body, 'dishes')) { known = true; valid(Array.isArray(body.dishes) && body.dishes.length <= 60); for (const dish of body.dishes) { menu([dish]); store(dish.seller); } }
  if (Object.hasOwn(body, 'store')) { known = true; if (body.store !== null) store(body.store); menu(body.menu); }
  if (Object.hasOwn(body, 'quote')) { known = true; snapshot(body.quote); valid(integer(body.quote.expiresAt)); }
  if (Object.hasOwn(body, 'order')) { known = true; order(body.order); }
  if (Object.hasOwn(body, 'orders')) { known = true; valid(Array.isArray(body.orders) && body.orders.length <= 50 && (body.nextBefore === null || id(body.nextBefore))); body.orders.forEach(order); }
  if (Object.hasOwn(body, 'current')) {
    known = true; valid(Array.isArray(body.current) && body.current.length <= 1); body.current.forEach(order);
    valid(typeof body.online === 'boolean' && typeof body.eligible === 'boolean' && body.isDemo === true && Array.isArray(body.available) && body.available.length <= 100);
    for (const j of body.available) valid(object(j) && id(j.id) && integer(j.version) && object(j.restaurant) && id(j.restaurant.id) && string(j.restaurant.name)
      && ((j.restaurant.sellerType ?? 'restaurant') === 'restaurant' ? string(j.restaurant.address) : string(j.restaurant.town) && j.restaurant.address === undefined)
      && object(j.deliveryArea) && string(j.deliveryArea.name) && integer(j.deliveryFeeKobo));
  }
  if (body.areas !== undefined) valid(Array.isArray(body.areas) && body.areas.length <= 50 && body.areas.every((a) => object(a) && string(a.id) && string(a.name)));
  valid(known); return body;
}
