/**
 * Nigerian state + town addressing, independent of launch/service availability.
 * State names follow the National Bureau of Statistics' state-level reports:
 * https://www.nigerianstat.gov.ng/pdfuploads/IGR_2023.pdf
 * This is not a gazetteer: a valid locality identifies a user's entered town,
 * not a verified postal address, coordinate, or promise of delivery coverage.
 */
export const NIGERIAN_STATES = Object.freeze([
  ['abia', 'Abia'], ['adamawa', 'Adamawa'], ['akwa-ibom', 'Akwa Ibom'],
  ['anambra', 'Anambra'], ['bauchi', 'Bauchi'], ['bayelsa', 'Bayelsa'],
  ['benue', 'Benue'], ['borno', 'Borno'], ['cross-river', 'Cross River'],
  ['delta', 'Delta'], ['ebonyi', 'Ebonyi'], ['edo', 'Edo'], ['ekiti', 'Ekiti'],
  ['enugu', 'Enugu'], ['fct', 'Federal Capital Territory'], ['gombe', 'Gombe'],
  ['imo', 'Imo'], ['jigawa', 'Jigawa'], ['kaduna', 'Kaduna'], ['kano', 'Kano'],
  ['katsina', 'Katsina'], ['kebbi', 'Kebbi'], ['kogi', 'Kogi'], ['kwara', 'Kwara'],
  ['lagos', 'Lagos'], ['nasarawa', 'Nasarawa'], ['niger', 'Niger'], ['ogun', 'Ogun'],
  ['ondo', 'Ondo'], ['osun', 'Osun'], ['oyo', 'Oyo'], ['plateau', 'Plateau'],
  ['rivers', 'Rivers'], ['sokoto', 'Sokoto'], ['taraba', 'Taraba'], ['yobe', 'Yobe'],
  ['zamfara', 'Zamfara'],
].map(([id, name]) => Object.freeze({ id, name })));
const states = new Map(NIGERIAN_STATES.map((state) => [state.id, state]));

// Preserve all existing order/profile identifiers and their exact display names.
export const LEGACY_FOOD_AREAS = Object.freeze([
  ['wuse-ii', 'Wuse II'], ['maitama', 'Maitama'], ['garki', 'Garki'],
  ['asokoro', 'Asokoro'], ['jabi', 'Jabi'], ['gwarinpa', 'Gwarinpa'],
  ['airport', 'Abuja Airport'],
].map(([id, name]) => Object.freeze({ id, name, town: name, stateId: 'fct', stateName: states.get('fct').name })));
const legacyIds = new Map(LEGACY_FOOD_AREAS.map((area) => [area.id, area]));
const legacyTowns = new Map(LEGACY_FOOD_AREAS.map((area) => [area.town.toLowerCase(), area.id]));

function normalizedTown(value) {
  if (typeof value !== 'string' || value.length > 320 || /[\p{Cc}\p{Cf}]/u.test(value)) {
    throw new Error('Enter a city, town or district with 2–80 characters.');
  }
  const town = value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
  if ([...town].length < 2 || [...town].length > 80
    || !/^[\p{L}\p{N}][\p{L}\p{M}\p{N} .\u0027\u2019-]*$/u.test(town)
    || !/\p{L}/u.test(town)) {
    throw new Error('Enter a city, town or district with 2–80 characters.');
  }
  return town;
}

/** Canonical ID, with legacy aliases so new addresses match existing kitchens. */
export function foodAreaId(stateId, town) {
  if (!states.has(stateId)) throw new Error('Choose a Nigerian state or the Federal Capital Territory.');
  const normalized = normalizedTown(town);
  if (stateId === 'fct' && legacyTowns.has(normalized)) return legacyTowns.get(normalized);
  return `ng:${stateId}:${encodeURIComponent(normalized)}`;
}

/** Safe, strict decoder for persisted/request IDs; never throws on bad input. */
export function resolveFoodArea(id) {
  if (typeof id !== 'string' || id.length > 1_000) return null;
  if (legacyIds.has(id)) return legacyIds.get(id);
  const parts = id.split(':');
  if (parts.length !== 3 || parts[0] !== 'ng' || !states.has(parts[1])) return null;
  try {
    const canonical = normalizedTown(decodeURIComponent(parts[2]));
    if (foodAreaId(parts[1], canonical) !== id) return null;
    const town = canonical.replace(/(^|[ -])(\p{L})/gu, (_, prefix, letter) => prefix + letter.toUpperCase());
    return Object.freeze({ id, name: town, town, stateId: parts[1], stateName: states.get(parts[1]).name });
  } catch { return null; }
}
