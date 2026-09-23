/** Food ordering rules shared by the clients and Eats service. Money is integer kobo. */
export const EATS_CUISINES = Object.freeze(['Nigerian', 'Grills', 'Burgers', 'Pizza', 'Healthy', 'Bakery', 'Drinks']);
export const EATS_STATUS = Object.freeze({ placed: 'Waiting for the kitchen', accepted: 'Order accepted', preparing: 'Preparing your food', ready: 'Ready for pickup', assigned: 'Courier collecting your food', picked_up: 'On the way', arrived: 'Your courier is here', delivered: 'Completed', cancelled: 'Cancelled', rejected: 'Declined by kitchen' });
export const EATS_SELLERS = Object.freeze({ restaurant: 'Restaurant', food_vendor: 'Food vendor', home_kitchen: 'Home kitchen' });
export const EATS_DISPATCH_RADIUS_METERS = 10_000;
// Missing coverage on a saved pre-national profile keeps its original preview
// coverage. It must never grow when nationwide locations become available.
export const EATS_LEGACY_AREA_IDS = Object.freeze(['wuse-ii', 'maitama', 'garki', 'asokoro', 'jabi', 'gwarinpa', 'airport']);
export function deliveryAreas(store) { return store.deliveryAreaIds ?? (EATS_LEGACY_AREA_IDS.includes(store.areaId) ? EATS_LEGACY_AREA_IDS : [store.areaId]); }
/** Only restaurants publish street addresses; other sellers share order-specific collection points. */
export function isPrivateKitchen(sellerType) { return sellerType === 'food_vendor' || sellerType === 'home_kitchen'; }
export function foodAvailable(item) { return item.available && (item.portionsRemaining == null || item.portionsRemaining > 0); }
export function foodStock(item) { return !foodAvailable(item) ? 'Sold out' : item.portionsRemaining == null ? 'Available' : `${item.portionsRemaining} portions left`; }
export function discoverKitchens(stores, { q = '', cuisine = '', areaId = '', sellerType = '', fulfillment = 'delivery', openOnly = false, sort = 'recommended' } = {}) {
  const query = q.trim().toLowerCase().slice(0, 100);
  return stores.filter((s) => (!cuisine || s.cuisine === cuisine) && (!areaId || s.areaId === areaId)
    && (!sellerType || (s.sellerType ?? 'restaurant') === sellerType) && (!openOnly || s.isOpen)
    && (fulfillment !== 'pickup' || s.pickupEnabled) && (fulfillment !== 'delivery' || s.deliveryEnabled !== false)
    && (!query || `${s.name} ${s.cuisine} ${s.description}`.toLowerCase().includes(query)))
    .sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || (sort === 'prep' ? a.prepMinutes - b.prepMinutes : sort === 'fee' ? a.deliveryFeeKobo - b.deliveryFeeKobo : 0) || a.name.localeCompare(b.name));
}
export const EATS_STEPS = Object.freeze(['placed', 'accepted', 'preparing', 'ready', 'assigned', 'picked_up', 'arrived', 'delivered']);
export const EATS_TERMINAL = Object.freeze(['delivered', 'cancelled', 'rejected']);
export const EATS_COLOURS = Object.freeze({ Nigerian: '#fff0bd', Grills: '#f5ded2', Burgers: '#f7e9cd', Pizza: '#f8dacf', Healthy: '#e1edd7', Bakery: '#eee3d4', Drinks: '#e1ebf0' });
export const EATS_SYMBOLS = Object.freeze({ Nigerian: '🍲', Grills: '🍗', Burgers: '🍔', Pizza: '🍕', Healthy: '🥗', Bakery: '🥐', Drinks: '🥤' });

export function eatsTotals(lines, deliveryFeeKobo) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 20) throw new Error('Choose between 1 and 20 menu items.');
  if (!Number.isSafeInteger(deliveryFeeKobo) || deliveryFeeKobo < 0 || deliveryFeeKobo > 2_000_000) throw new Error('Invalid delivery fee.');
  let subtotalKobo = 0;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) throw new Error('Choose 1–20 portions per item.');
    if (!Number.isSafeInteger(line.priceKobo) || line.priceKobo < 100 || line.priceKobo > 5_000_000) throw new Error('Invalid menu price.');
    subtotalKobo += line.priceKobo * line.quantity;
  }
  if (subtotalKobo > 20_000_000) throw new Error('This test order exceeds the ₦200,000 limit.');
  const serviceFeeKobo = Math.min(Math.round(subtotalKobo * 5 / 100), 100_000);
  const totalKobo = subtotalKobo + deliveryFeeKobo + serviceFeeKobo;
  if (totalKobo > 20_000_000) throw new Error('The total including fees exceeds the ₦200,000 test limit.');
  return { subtotalKobo, deliveryFeeKobo, serviceFeeKobo, totalKobo, currency: 'NGN' };
}

export function cartQuantity(cart, itemId, quantity) {
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 20) throw new Error('Choose 0–20 portions.');
  const next = cart.filter((line) => line.itemId !== itemId);
  if (quantity) next.push({ itemId, quantity });
  if (next.length > 20) throw new Error('A cart can contain up to 20 different items.');
  return next;
}

export function eatsActions(order, role) {
  const pickup = (order.fulfillment ?? order.snapshot?.fulfillment) === 'pickup';
  if (EATS_TERMINAL.includes(order.status)) return [];
  if (role === 'customer') return order.status === 'placed' ? ['cancel'] : [];
  if (role === 'store') return ({ placed: ['accept', 'reject'], accepted: ['prepare'], preparing: ['ready'], ...(pickup ? { ready: ['complete_pickup'] } : {}) })[order.status] ?? [];
  if (role === 'courier') return pickup ? [] : ({ ready: ['claim'], assigned: ['pickup'], picked_up: ['arrive'], arrived: ['deliver'] })[order.status] ?? [];
  if (role === 'admin') return ['placed', 'accepted', 'preparing', 'ready', 'assigned'].includes(order.status) ? ['cancel'] : [];
  return [];
}
