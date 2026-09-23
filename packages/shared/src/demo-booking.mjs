// Fictional fixtures for interface testing, not local market quotes or an AI model.
export const DEMO_AREAS = Object.freeze([
  Object.freeze({ id: 'wuse-ii', name: 'Wuse II' }),
  Object.freeze({ id: 'maitama', name: 'Maitama' }),
  Object.freeze({ id: 'garki', name: 'Garki' }),
  Object.freeze({ id: 'asokoro', name: 'Asokoro' }),
  Object.freeze({ id: 'jabi', name: 'Jabi' }),
  Object.freeze({ id: 'gwarinpa', name: 'Gwarinpa' }),
  Object.freeze({ id: 'airport', name: 'Abuja Airport' }),
]);

export function matchSampleArea(areas, text) {
  const query = text.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!query) return null;
  return areas.find((area) => area.name.toLowerCase() === query || area.id === query) ?? null;
}

export function createDemoQuote(pickupId, destinationId) {
  const pickup = DEMO_AREAS.find((area) => area.id === pickupId);
  const destination = DEMO_AREAS.find((area) => area.id === destinationId);
  if (!pickup || !destination) throw new Error('Choose both areas from the sample locations.');
  if (pickupId === destinationId) throw new Error('Choose a destination different from your pickup.');
  const ids = [pickupId, destinationId];
  const suggestedFareKobo = ids.includes('airport') ? 1_200_000
    : ids.includes('gwarinpa') ? 550_000 : 450_000;
  return { pickup, destination, suggestedFareKobo, currency: 'NGN', isDemo: true };
}

export function nairaToKobo(value) {
  // Parse decimal strings without multiplying a floating-point fraction.
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) {
    throw new Error('Enter a positive amount with up to two decimal places, for example 4500.50.');
  }
  const [naira, fraction = ''] = value.trim().split('.');
  const kobo = Number(naira) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(kobo) || kobo <= 0) throw new Error('Enter a valid amount greater than zero.');
  return kobo;
}

export function formatNaira(kobo) {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency', currency: 'NGN', minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(kobo / 100);
}
