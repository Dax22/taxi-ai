import { EATS_CUISINES, EATS_SELLERS, foodAvailable, eatsTotals, isPrivateKitchen, deliveryAreas } from '../../../../../packages/shared/src/eats.mjs';
import { resolveFoodArea } from '../../../../../packages/shared/src/nigeria-areas.mjs';
import { insideNigeria } from '../../../../../packages/shared/src/locations.mjs';
import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';

export const canonical = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
export function version(value, expected) { check(Number.isSafeInteger(expected) && expected >= 0, 'INVALID_VERSION', 'Use the version shown on screen.'); check(value.version === expected, 'STALE_VERSION', 'This changed. Refresh and review the saved details.'); }
export function amount(value, name, max = 2_000_000) { check(Number.isSafeInteger(value) && value >= 0 && value <= max, 'INVALID_PRICE', `${name} must be a nonnegative amount within the test limit.`); return value; }
export function area(id) { const value = resolveFoodArea(id); check(value, 'INVALID_AREA', 'Choose a Nigerian state and enter the town or area.'); return value; }
export function dispatchPoint(value) {
  if (value === null || value === undefined) return null;
  fields(value, ['lat', 'lng']);
  check(insideNigeria(value), 'INVALID_LOCATION', 'Choose a kitchen dispatch location within Nigeria.');
  return { lat: Number(value.lat.toFixed(6)), lng: Number(value.lng.toFixed(6)) };
}
export function storeDetails(data, previous = {}) {
  const required = ['name', 'cuisine', 'description', 'areaId', 'prepMinutes', 'minimumKobo', 'deliveryFeeKobo'];
  fields(data, [...required, 'address', 'sellerType', 'deliveryEnabled', 'pickupEnabled', 'deliveryAreaIds', 'dispatchPoint'], required);
  const submitted = data.sellerType ?? previous.sellerType ?? 'restaurant';
  const sellerType = ({ vendor: 'food_vendor', private_kitchen: 'home_kitchen' })[submitted] ?? submitted;
  const deliveryEnabled = data.deliveryEnabled ?? previous.deliveryEnabled ?? true, pickupEnabled = data.pickupEnabled ?? previous.pickupEnabled ?? false;
  check(Object.hasOwn(EATS_SELLERS, sellerType), 'INVALID_STORE', 'Choose restaurant, food vendor or home kitchen.');
  check(typeof deliveryEnabled === 'boolean' && typeof pickupEnabled === 'boolean' && (deliveryEnabled || pickupEnabled), 'INVALID_STORE', 'Offer delivery, customer pickup, or both.');
  check(EATS_CUISINES.includes(data.cuisine), 'INVALID_CUISINE', 'Choose a cuisine.'); area(data.areaId);
  const deliveryAreaIds = data.deliveryAreaIds ?? (previous.areaId === data.areaId ? deliveryAreas(previous) : [data.areaId]);
  check(Array.isArray(deliveryAreaIds) && deliveryAreaIds.length <= 50 && new Set(deliveryAreaIds).size === deliveryAreaIds.length && (!deliveryEnabled || deliveryAreaIds.length > 0), 'INVALID_AREA', 'Choose up to 50 towns or areas you deliver to.');
  deliveryAreaIds.forEach(area);
  check(Number.isSafeInteger(data.prepMinutes) && data.prepMinutes >= 10 && data.prepMinutes <= 120, 'INVALID_PREPARATION', 'Choose 10–120 minutes for preparation.');
  return { sellerType, deliveryEnabled, pickupEnabled, deliveryAreaIds, dispatchPoint: dispatchPoint(Object.hasOwn(data, 'dispatchPoint') ? data.dispatchPoint : previous.areaId === data.areaId ? previous.dispatchPoint : null), name: label(data.name, 'Kitchen name', 2, 80), cuisine: data.cuisine, description: label(data.description, 'Description', 2, 300),
    address: isPrivateKitchen(sellerType) ? label(data.address ?? previous.address ?? '', 'Private pickup address', 0, 240) : label(data.address, 'Restaurant address', 8, 240), areaId: data.areaId, prepMinutes: data.prepMinutes,
    minimumKobo: amount(data.minimumKobo, 'Minimum order', 5_000_000), deliveryFeeKobo: amount(data.deliveryFeeKobo, 'Delivery fee') };
}
export function menuDetails(data, store, previous = {}) {
  const required = ['name', 'description', 'category', 'priceKobo', 'available'];
  fields(data, [...required, 'portionsRemaining', 'allergens'], required);
  const portionsRemaining = Object.hasOwn(data, 'portionsRemaining') ? data.portionsRemaining : previous.portionsRemaining ?? null;
  check(portionsRemaining === null && store.sellerType !== 'home_kitchen' || Number.isSafeInteger(portionsRemaining) && portionsRemaining >= 0 && portionsRemaining <= 1000, 'INVALID_MENU', 'Set 0–1,000 portions available. Home kitchens need a batch quantity.');
  check(typeof data.available === 'boolean', 'INVALID_MENU', 'Choose whether this item is available.');
  check(Number.isSafeInteger(data.priceKobo) && data.priceKobo >= 100 && data.priceKobo <= 5_000_000, 'INVALID_PRICE', 'Choose a menu price from ₦1 to ₦50,000.');
  return { name: label(data.name, 'Item name', 2, 80), description: label(data.description, 'Ingredients and description', 2, 300),
    allergens: label(data.allergens ?? previous.allergens ?? '', 'Allergen information', 0, 300), portionsRemaining,
    category: label(data.category, 'Menu section', 2, 40), priceKobo: data.priceKobo, available: data.available };
}
export function checkedBasket(store, menu, data) {
  const required = ['storeId', 'expectedVersion', 'items', 'address', 'instructions'];
  fields(data, [...required, 'fulfillment'], required);
  const fulfillment = data.fulfillment ?? 'delivery';
  check(['delivery', 'pickup'].includes(fulfillment), 'INVALID_CART', 'Choose delivery or customer pickup.');
  check(fulfillment === 'pickup' ? store.pickupEnabled : store.deliveryEnabled !== false, 'STORE_UNAVAILABLE', 'This kitchen does not offer that order option.');
  version(store, data.expectedVersion);
  fields(data.address, ['line', 'areaId']);
  if (fulfillment === 'delivery') area(data.address.areaId);
  check(fulfillment !== 'delivery' || deliveryAreas(store).includes(data.address.areaId), 'STORE_UNAVAILABLE', 'This kitchen does not deliver to the selected town or area.');
  check(Array.isArray(data.items) && data.items.length > 0 && data.items.length <= 20, 'INVALID_CART', 'Choose 1–20 menu items.');
  check(new Set(data.items.map((i) => i?.itemId)).size === data.items.length, 'INVALID_CART', 'Combine duplicate items into one quantity.');
  const lines = data.items.map((line) => {
    fields(line, ['itemId', 'quantity']);
    const item = menu.find((i) => i.id === line.itemId && foodAvailable(i));
    check(item, 'MENU_CHANGED', 'An item is unavailable. Review the menu before checking out.');
    check(item.portionsRemaining == null || line.quantity <= item.portionsRemaining, 'MENU_CHANGED', 'There are fewer portions left. Review your quantities.');
    return { itemId: item.id, batchId: item.batchId ?? null, allergens: item.allergens ?? '', name: item.name, description: item.description, quantity: line.quantity, priceKobo: item.priceKobo };
  });
  let totals;
  try { totals = eatsTotals(lines, fulfillment === 'pickup' ? 0 : store.deliveryFeeKobo); } catch (error) { check(false, 'INVALID_CART', error.message); }
  check(totals.subtotalKobo >= store.minimumKobo, 'INVALID_CART', 'Add items to meet this kitchen’s minimum order.');
  return { fulfillment, restaurant: { sellerType: store.sellerType, id: store.id, name: store.name, address: isPrivateKitchen(store.sellerType) ? '' : store.address, areaId: store.areaId, prepMinutes: store.prepMinutes }, lines, totals,
    address: fulfillment === 'pickup' ? { areaId: store.areaId } : { line: label(data.address.line, 'Delivery address and landmark', 8, 240), areaId: data.address.areaId },
    instructions: label(data.instructions, 'Delivery or kitchen instructions', 0, 240), isDemo: true, payment: { method: 'test', status: 'not_charged' } };
}
