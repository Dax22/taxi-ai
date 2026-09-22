import { EATS_CUISINES, eatsTotals } from '../../../../../packages/shared/src/eats.mjs';
import { DEMO_AREAS } from '../../../../../packages/shared/src/demo-booking.mjs';
import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';

export const canonical = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
export function version(value, expected) { check(Number.isSafeInteger(expected) && expected >= 0, 'INVALID_VERSION', 'Use the version shown on screen.'); check(value.version === expected, 'STALE_VERSION', 'This changed. Refresh and review the saved details.'); }
export function amount(value, name, max = 2_000_000) { check(Number.isSafeInteger(value) && value >= 0 && value <= max, 'INVALID_PRICE', `${name} must be a nonnegative amount within the test limit.`); return value; }
export function area(id) { const value = DEMO_AREAS.find((a) => a.id === id); check(value, 'INVALID_AREA', 'Choose an Abuja delivery area.'); return value; }
export function storeDetails(data) {
  fields(data, ['name', 'cuisine', 'description', 'address', 'areaId', 'prepMinutes', 'minimumKobo', 'deliveryFeeKobo']);
  check(EATS_CUISINES.includes(data.cuisine), 'INVALID_CUISINE', 'Choose a cuisine.'); area(data.areaId);
  check(Number.isSafeInteger(data.prepMinutes) && data.prepMinutes >= 10 && data.prepMinutes <= 120, 'INVALID_PREPARATION', 'Choose 10–120 minutes for preparation.');
  return { name: label(data.name, 'Store name', 2, 80), cuisine: data.cuisine, description: label(data.description, 'Description', 2, 300),
    address: label(data.address, 'Pickup address', 8, 240), areaId: data.areaId, prepMinutes: data.prepMinutes,
    minimumKobo: amount(data.minimumKobo, 'Minimum order', 5_000_000), deliveryFeeKobo: amount(data.deliveryFeeKobo, 'Delivery fee') };
}
export function menuDetails(data) {
  fields(data, ['name', 'description', 'category', 'priceKobo', 'available']);
  check(typeof data.available === 'boolean', 'INVALID_MENU', 'Choose whether this item is available.');
  check(Number.isSafeInteger(data.priceKobo) && data.priceKobo >= 100 && data.priceKobo <= 5_000_000, 'INVALID_PRICE', 'Choose a menu price from ₦1 to ₦50,000.');
  return { name: label(data.name, 'Item name', 2, 80), description: label(data.description, 'Ingredients and description', 2, 300),
    category: label(data.category, 'Menu section', 2, 40), priceKobo: data.priceKobo, available: data.available };
}
export function checkedBasket(store, menu, data) {
  fields(data, ['storeId', 'expectedVersion', 'items', 'address', 'instructions']);
  version(store, data.expectedVersion);
  fields(data.address, ['line', 'areaId']); area(data.address.areaId);
  check(Array.isArray(data.items) && data.items.length > 0 && data.items.length <= 20, 'INVALID_CART', 'Choose 1–20 menu items.');
  check(new Set(data.items.map((i) => i?.itemId)).size === data.items.length, 'INVALID_CART', 'Combine duplicate items into one quantity.');
  const lines = data.items.map((line) => {
    fields(line, ['itemId', 'quantity']);
    const item = menu.find((i) => i.id === line.itemId && i.available);
    check(item, 'MENU_CHANGED', 'An item is unavailable. Review the menu before checking out.');
    return { itemId: item.id, name: item.name, description: item.description, quantity: line.quantity, priceKobo: item.priceKobo };
  });
  let totals;
  try { totals = eatsTotals(lines, store.deliveryFeeKobo); } catch (error) { check(false, 'INVALID_CART', error.message); }
  check(totals.subtotalKobo >= store.minimumKobo, 'INVALID_CART', 'Add items to meet this restaurant’s minimum order.');
  return { restaurant: { id: store.id, name: store.name, address: store.address, areaId: store.areaId, prepMinutes: store.prepMinutes }, lines, totals,
    address: { line: label(data.address.line, 'Delivery address and landmark', 8, 240), areaId: data.address.areaId },
    instructions: label(data.instructions, 'Delivery or kitchen instructions', 0, 240), isDemo: true, payment: { method: 'test', status: 'not_charged' } };
}
