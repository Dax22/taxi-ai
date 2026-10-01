import { check } from '../shared/errors.mjs';

const ATTRIBUTION = '© OpenStreetMap contributors · Photon';
const MAX_RESPONSE_BYTES = 128_000;
const REVERSE_RADIUS_METERS = 200;
const communityDomains = ['komoot.io', 'openstreetmap.de', 'openstreetmap.org', 'project-osrm.org'];
const clean = (value, maximum = 120) => typeof value === 'string' && value.length <= maximum
  && !/[\p{Cc}\p{Cf}<>]/u.test(value) ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ') : '';
const stateKey = (value) => clean(value, 100).toLowerCase().replace(/\s+state$/, '').replace(/-/g, ' ');

function endpoint(value) {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    || url.username || url.password || url.search || url.hash) {
    throw new Error('TAXI_AI_REVERSE_URL needs HTTPS (or loopback HTTP), without credentials, queries or fragments.');
  }
  return url;
}

function suggestion(result, point, { insideNigeria, distanceMeters, foodAreaId, states }) {
  if (!result || result.type && result.type !== 'FeatureCollection' || !Array.isArray(result.features)) return null;
  const nearest = result.features.slice(0, 5).flatMap((feature) => {
    const coordinates = feature?.geometry?.coordinates, properties = feature?.properties;
    if (feature?.geometry?.type !== 'Point' || !Array.isArray(coordinates) || coordinates.length !== 2
      || typeof properties?.countrycode !== 'string' || properties.countrycode.toUpperCase() !== 'NG') return [];
    const location = { lng: coordinates[0], lat: coordinates[1] };
    if (!insideNigeria(location)) return [];
    const distance = distanceMeters(point, location);
    return distance <= REVERSE_RADIUS_METERS ? [{ properties, distance }] : [];
  }).sort((a, b) => a.distance - b.distance)[0];
  if (!nearest) return null;
  const p = nearest.properties, state = states.get(stateKey(p.state));
  const district = clean(p.district, 80), city = clean(p.city, 80), locality = clean(p.locality, 80);
  let areaId = null;
  // Provider administrative labels only; a missing town never becomes the
  // state's capital. The user must confirm every returned address suggestion.
  if (state && (district || city || locality)) {
    try { areaId = foodAreaId(state.id, district || city || locality); } catch { /* Manual area selection remains available. */ }
  }
  const street = clean(p.street), house = street ? clean(p.housenumber, 24) : '';
  // A nearby POI name is not a residential address and is deliberately omitted.
  const parts = [[house, street].filter(Boolean).join(' '), district, city || locality, state?.name ?? clean(p.state, 100)].filter(Boolean);
  const seen = new Set();
  const line = parts.filter((part) => {
    const key = part.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true;
  }).join(', ').slice(0, 240);
  return line || areaId ? { line, areaId, attribution: ATTRIBUTION } : null;
}

/** Optional address suggestions, invoked only after an explicit location action.
 * No cache, request log, persistent location or home-address inference. Photon
 * reverse contract: https://github.com/komoot/photon/blob/master/docs/api-v1.md
 */
export function createFoodLocationProvider({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now,
  timeoutMs = 2500, maxConcurrent = 2, insideNigeria, distanceMeters, foodAreaId, states: stateDefinitions } = {}) {
  if (![insideNigeria, distanceMeters, foodAreaId].every((value) => typeof value === 'function')
    || !Array.isArray(stateDefinitions) || !stateDefinitions.length) {
    throw new Error('Food location provider requires injected location and area policies.');
  }
  const states = new Map(stateDefinitions.flatMap((state) => [[stateKey(state.name), state], [stateKey(state.id), state]]));
  const federalCapitalTerritory = stateDefinitions.find((state) => state.id === 'fct');
  for (const alias of ['fct', 'federal capital territory (fct)', 'abuja federal capital territory']) {
    if (federalCapitalTerritory) states.set(alias, federalCapitalTerritory);
  }
  const locationPolicies = { insideNigeria, distanceMeters, foodAreaId, states };
  const mode = env.TAXI_AI_MAPS_MODE ?? 'community';
  if (!['community', 'dedicated', 'off'].includes(mode)) throw new Error('TAXI_AI_MAPS_MODE must be community, dedicated or off.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 8000
    || !Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 8) {
    throw new Error('Food location timeout or concurrency is outside supported limits.');
  }
  // Dedicated deployments opt in with their own compatible reverse endpoint.
  // Never send coordinates to a community fallback for a dedicated deployment.
  const configuredUrl = env.TAXI_AI_REVERSE_URL?.trim();
  const reverseUrl = configuredUrl ? endpoint(configuredUrl) : mode === 'community' ? endpoint('https://photon.komoot.io/reverse') : null;
  if (mode === 'dedicated' && reverseUrl && communityDomains.some((domain) => reverseUrl.hostname === domain || reverseUrl.hostname.endsWith(`.${domain}`))) {
    throw new Error('Dedicated reverse geocoding cannot target community map services.');
  }
  const apiKey = env.TAXI_AI_MAPS_API_KEY;
  if (apiKey !== undefined && (mode !== 'dedicated' || typeof apiKey !== 'string' || !apiKey.length || apiKey.length > 2048 || /[\r\n]/.test(apiKey))) {
    throw new Error('TAXI_AI_MAPS_API_KEY needs a valid dedicated-provider bearer credential.');
  }
  const enabled = mode !== 'off' && reverseUrl !== null;
  const minimumIntervalMs = mode === 'community' ? 1100 : 100;
  let active = 0, lastStart = -Infinity;
  async function resolveDeliveryLocation(input) {
    check(insideNigeria(input), 'INVALID_LOCATION', 'Choose a delivery location in Nigeria.');
    const point = { lat: Number(input.lat.toFixed(6)), lng: Number(input.lng.toFixed(6)) };
    check(insideNigeria(point), 'INVALID_LOCATION', 'Choose a delivery location in Nigeria.');
    const empty = () => ({ point: { ...point }, line: '', areaId: null, attribution: '' });
    if (!enabled || active >= maxConcurrent || now() - lastStart < minimumIntervalMs) return empty();
    const url = new URL(reverseUrl);
    for (const [key, value] of Object.entries({ lat: point.lat, lon: point.lng, radius: REVERSE_RADIUS_METERS / 1000, limit: 5, lang: 'en' })) {
      url.searchParams.set(key, String(value));
    }
    lastStart = now(); active += 1;
    const controller = new AbortController(); let timer;
    const task = Promise.resolve().then(async () => {
      const response = await fetchImpl(url, { signal: controller.signal, redirect: 'error',
        headers: { Accept: 'application/json', 'User-Agent': 'TaxiAi/0.27 (+https://github.com/Dax22/taxi-ai)',
          ...(mode === 'dedicated' && apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) } });
      if (!response.ok || !response.body) return empty();
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.byteLength;
          if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); return empty(); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const address = suggestion(JSON.parse(Buffer.concat(chunks).toString('utf8')), point, locationPolicies);
      return address ? { point: { ...point }, ...address } : empty();
    }).catch(empty).finally(() => { active -= 1; });
    const deadline = new Promise((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(empty()); }, timeoutMs); });
    try { return await Promise.race([task, deadline]); }
    finally { clearTimeout(timer); }
    // Timed-out fetches retain their slot until settlement even if a custom
    // adapter ignores AbortSignal, preventing unbounded background requests.
  }
  return Object.freeze({ mode, enabled, resolveDeliveryLocation });
}
