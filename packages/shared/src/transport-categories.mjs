/** Illustrative preview policy, not vehicle specifications or local market rates. */
export const TRANSPORT_CATEGORIES = Object.freeze({
  standard: Object.freeze({ service: 'ride', multiplier: 100, maxLoadKg: null }),
  suv: Object.freeze({ service: 'ride', multiplier: 150, maxLoadKg: null }),
  van: Object.freeze({ service: 'delivery', multiplier: 180, maxLoadKg: 500 }),
  truck: Object.freeze({ service: 'delivery', multiplier: 300, maxLoadKg: 3000 }),
  motorcycle: Object.freeze({ service: 'delivery', multiplier: 70, maxLoadKg: 20 }),
});
export function transportCategory(id = 'standard') {
  return typeof id === 'string' && Object.hasOwn(TRANSPORT_CATEGORIES, id) ? TRANSPORT_CATEGORIES[id] : null;
}
export function categoryFare(kobo, id = 'standard') {
  const category = transportCategory(id);
  if (!category || !Number.isSafeInteger(kobo) || kobo <= 0) throw new Error('Invalid category fare.');
  // Integer arithmetic retains the preview's NGN 50 rounding increment.
  const amount = Number((BigInt(kobo) * BigInt(category.multiplier) + 499999n) / 500000n * 5000n);
  if (!Number.isSafeInteger(amount)) throw new Error('Invalid category fare.');
  return amount;
}
export function validPayload(categoryId, value) {
  const category = transportCategory(categoryId);
  return category?.service === 'delivery' && Number.isFinite(value) && value > 0
    && value <= category.maxLoadKg && Math.abs(value * 1000 - Math.round(value * 1000)) < 0.000001;
}
export function deliveryDetails(categoryId, data) {
  const category = transportCategory(categoryId);
  if (!category) throw new Error('Choose a vehicle category.');
  if (category.service === 'ride') {
    if (data !== undefined && data !== null) throw new Error('Parcel details are only for deliveries.');
    return null;
  }
  const required = ['description', 'weightKg', 'recipientName'];
  const optional = ['pickupInstructions', 'dropoffInstructions'];
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || !required.every((key) => Object.hasOwn(data, key))
    || !Object.keys(data).every((key) => [...required, ...optional].includes(key))) {
    throw new Error('Add the parcel description, total weight and recipient name.');
  }
  const clean = (value, name, min, max) => {
    if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
      throw new Error(`${name} must contain ${min}–${max} characters.`);
    }
    return value.trim();
  };
  if (!validPayload(categoryId, data.weightKg)) throw new Error(`Enter a total weight above zero and up to ${category.maxLoadKg} kg (preview limit).`);
  return { description: clean(data.description, 'Parcel description', 2, 240), weightKg: data.weightKg,
    recipientName: clean(data.recipientName, 'Recipient name', 2, 100),
    pickupInstructions: clean(data.pickupInstructions ?? '', 'Pickup instructions', 0, 240),
    dropoffInstructions: clean(data.dropoffInstructions ?? '', 'Drop-off instructions', 0, 240) };
}
export function vehicleMatches(vehicle, categoryId, weightKg = null) {
  if (!transportCategory(categoryId) || (vehicle?.category ?? 'standard') !== categoryId) return false;
  return transportCategory(categoryId).service === 'ride'
    || (validPayload(categoryId, vehicle?.payloadKg) && validPayload(categoryId, weightKg) && weightKg <= vehicle.payloadKg);
}
