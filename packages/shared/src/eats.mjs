/** Food ordering rules shared by the clients and Eats service. Money is integer kobo. */
export const EATS_CUISINES = Object.freeze(['Nigerian', 'Grills', 'Burgers', 'Pizza', 'Healthy', 'Bakery', 'Drinks']);
export const EATS_STATUS = Object.freeze({ placed: 'Waiting for the restaurant', accepted: 'Order accepted', preparing: 'Preparing your food', ready: 'Ready for pickup', assigned: 'Courier collecting your food', picked_up: 'On the way', arrived: 'Your courier is here', delivered: 'Delivered', cancelled: 'Cancelled', rejected: 'Declined by restaurant' });
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
  if (EATS_TERMINAL.includes(order.status)) return [];
  if (role === 'customer') return order.status === 'placed' ? ['cancel'] : [];
  if (role === 'store') return ({ placed: ['accept', 'reject'], accepted: ['prepare'], preparing: ['ready'] })[order.status] ?? [];
  if (role === 'courier') return ({ ready: ['claim'], assigned: ['pickup'], picked_up: ['arrive'], arrived: ['deliver'] })[order.status] ?? [];
  if (role === 'admin') return ['placed', 'accepted', 'preparing', 'ready', 'assigned'].includes(order.status) ? ['cancel'] : [];
  return [];
}
