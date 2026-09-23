/** Menu-backed search and basket rules; never invent a dish, price or seller. */
export const MEAL_LIMITS = Object.freeze({ kitchens: 5, lines: 20, quantity: 20, totalKobo: 20_000_000 });
const normalise = (value) => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ignored = new Set('i me my want would like to eat have some a an the and with plus please food dish dishes something order'.split(' '));
export function mealTerms(query) {
  return [...new Set(normalise(query).split(' ').filter((word) => word.length > 1 && !ignored.has(word)))].slice(0, 24);
}
export function matchMeals(foods, query) {
  const terms = mealTerms(query);
  return foods.map((food) => {
    const name = normalise(food.item.name), description = normalise(`${food.item.description} ${food.item.category}`);
    const score = terms.reduce((sum, term) => sum + (name.split(' ').some((w) => w.startsWith(term)) ? 3 : description.split(' ').some((w) => w.startsWith(term)) ? 1 : 0), 0);
    return { food, score };
  }).filter(({ score }) => !terms.length || score > 0)
    .sort((a, b) => b.score - a.score || a.food.item.priceKobo - b.food.item.priceKobo || a.food.store.name.localeCompare(b.food.store.name) || a.food.item.id.localeCompare(b.food.item.id))
    .map(({ food }) => food);
}
export function mealQuantity(basket, food, quantity) {
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > MEAL_LIMITS.quantity) throw new Error('Choose 0–20 portions of a dish.');
  const rest = basket.filter((line) => line.item.id !== food.item.id);
  const next = quantity ? [...rest, { ...food, quantity }] : rest;
  if (next.length > MEAL_LIMITS.lines || new Set(next.map((line) => line.store.id)).size > MEAL_LIMITS.kitchens) throw new Error('Combine up to 20 dishes from 5 kitchens.');
  return next;
}
export function mealGroups(basket) {
  const groups = new Map();
  for (const line of basket) {
    let group = groups.get(line.store.id);
    if (!group) { group = { storeId: line.store.id, expectedVersion: line.store.version, items: [] }; groups.set(line.store.id, group); }
    // Use the newest menu observed for this kitchen; the server still verifies every item.
    group.expectedVersion = Math.max(group.expectedVersion, line.store.version);
    group.items.push({ itemId: line.item.id, quantity: line.quantity });
  }
  return [...groups.values()];
}
export function mealTotals(quotes) {
  const totals = { subtotalKobo: 0, deliveryFeeKobo: 0, serviceFeeKobo: 0, totalKobo: 0, currency: 'NGN' };
  for (const quote of quotes) for (const key of ['subtotalKobo', 'deliveryFeeKobo', 'serviceFeeKobo', 'totalKobo']) {
    const value = quote.totals?.[key];
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid kitchen total.');
    totals[key] += value;
  }
  if (totals.totalKobo > MEAL_LIMITS.totalKobo || totals.totalKobo !== totals.subtotalKobo + totals.deliveryFeeKobo + totals.serviceFeeKobo) throw new Error('Combined orders must stay within ₦200,000.');
  return totals;
}
