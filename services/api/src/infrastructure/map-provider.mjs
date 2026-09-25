import { ApplicationError, check } from '../shared/errors.mjs';

const unavailable = () => new ApplicationError('MAPS_UNAVAILABLE', 'Online maps are unavailable. Retry later or use the sample-area demo.');
function endpoint(value) {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    || url.username || url.password || url.search || url.hash) throw new Error('Map API URLs need HTTPS (or loopback HTTP), without credentials, queries or fragments.');
  return url;
}
export function createMapProvider({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const mode = env.TAXI_AI_MAPS_MODE ?? 'community';
  if (!['community', 'dedicated', 'off'].includes(mode)) throw new Error('TAXI_AI_MAPS_MODE must be community, dedicated or off.');
  const searchUrl = endpoint(env.TAXI_AI_SEARCH_URL ?? 'https://photon.komoot.io/api/');
  const routeUrl = endpoint(env.TAXI_AI_ROUTING_URL ?? 'https://routing.openstreetmap.de/routed-car/route/v1/driving/');
  const tiles = env.TAXI_AI_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileUrl = endpoint(tiles.replace('{z}', '1').replace('{x}', '1').replace('{y}', '1'));
  if (!['{z}', '{x}', '{y}'].every((token) => tiles.split(token).length === 2)) throw new Error('TAXI_AI_TILE_URL needs exactly one {z}, {x} and {y}.');
  const dedicated = mode === 'dedicated';
  const integer = (key, fallback, maximum) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`${key} needs an integer from 1 to ${maximum}.`);
    return value;
  };
  const requestsPerSecond = integer('TAXI_AI_MAPS_REQUESTS_PER_SECOND', dedicated ? 10 : 1, 1000);
  const maxConcurrent = integer('TAXI_AI_MAPS_MAX_CONCURRENT', dedicated ? 8 : 2, 64);
  const timeoutMs = integer('TAXI_AI_MAPS_TIMEOUT_MS', 8000, 15_000);
  const maxCacheEntries = integer('TAXI_AI_MAPS_CACHE_ENTRIES', dedicated ? 1000 : 100, 10_000);
  if (!dedicated && (requestsPerSecond !== 1 || maxConcurrent > 2 || maxCacheEntries > 100)) {
    throw new Error('Higher map budgets require TAXI_AI_MAPS_MODE=dedicated and dedicated endpoints.');
  }
  if (dedicated) {
    if (!env.TAXI_AI_SEARCH_URL || !env.TAXI_AI_ROUTING_URL || !env.TAXI_AI_TILE_URL) {
      throw new Error('Dedicated maps require explicit search, routing and tile URLs.');
    }
    const communityDomains = ['komoot.io', 'openstreetmap.de', 'openstreetmap.org', 'project-osrm.org'];
    if ([searchUrl, routeUrl, tileUrl].some((url) => communityDomains.some((domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)))) {
      throw new Error('Dedicated map budgets cannot target community map services.');
    }
  }
  const apiKey = env.TAXI_AI_MAPS_API_KEY;
  if (apiKey !== undefined && (!dedicated || typeof apiKey !== 'string' || !apiKey.length || apiKey.length > 2048 || /[\r\n]/.test(apiKey))) {
    throw new Error('TAXI_AI_MAPS_API_KEY needs a valid dedicated-provider bearer credential.');
  }
  const cache = new Map(), pending = new Map(), last = new Map();
  const starts = [];
  let active = 0;
  async function json(url, kind, ttl) {
    check(mode !== 'off', 'MAPS_UNAVAILABLE', 'Online maps are disabled. The sample-area demo remains available.');
    const cacheKey = url.href;
    const cached = cache.get(cacheKey);
    if (cached && cached.until > now()) return structuredClone(cached.value);
    if (pending.has(cacheKey)) return structuredClone(await pending.get(cacheKey));
    const at = now();
    while (starts.length && starts[0] <= at - 1000) starts.shift();
    check(active < maxConcurrent && (dedicated ? starts.length < requestsPerSecond
      : at - (last.get(kind) ?? -Infinity) >= 1100), 'MAPS_BUSY', 'Please wait a moment before another map request.');
    last.set(kind, now());
    if (dedicated) starts.push(at);
    active += 1;
    const task = (async () => {
      try {
        const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'TaxiAi/0.27 (+https://github.com/Dax22/taxi-ai)',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
          signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
        if (!response.ok) throw unavailable();
        const reader = response.body.getReader(), chunks = []; let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > 1_000_000) { await reader.cancel(); throw unavailable(); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (cache.size >= maxCacheEntries) cache.delete(cache.keys().next().value);
        cache.set(cacheKey, { until: now() + ttl, value });
        return value;
      } catch (error) { if (error instanceof ApplicationError) throw error; throw unavailable(); }
      finally { active -= 1; pending.delete(cacheKey); }
    })();
    pending.set(cacheKey, task);
    return structuredClone(await task);
  }
  const maxPickupPairs = dedicated ? 64 : 16;
  return Object.freeze({ mode, tileOrigin: tileUrl.origin, maxPickupPairs,
    describe: () => ({ enabled: mode !== 'off', mode, tiles: mode === 'off' ? null : tiles,
      searchHost: searchUrl.host, routeHost: routeUrl.host, tileHost: tileUrl.host }),
    async search(query, bounds) {
      const url = new URL(searchUrl);
      for (const [name, value] of Object.entries({ q: query, limit: '8', lang: 'en', countrycode: 'NG',
        bbox: `${bounds.west},${bounds.south},${bounds.east},${bounds.north}` })) url.searchParams.set(name, value);
      const result = await json(url, 'search', 60 * 60_000);
      check(result && (!result.type || result.type === 'FeatureCollection') && Array.isArray(result.features), 'MAPS_UNAVAILABLE', 'Address search returned an invalid response.');
      return result.features.filter((f) => f?.geometry?.type === 'Point'
        && (!f.properties?.countrycode || String(f.properties.countrycode).toUpperCase() === 'NG')).slice(0, 8).map((f) => {
        const p = f.properties ?? {};
        const name = [...new Set([p.name, [p.housenumber, p.street].filter((v) => typeof v === 'string').join(' '), p.district, p.city, p.state]
          .filter((v) => typeof v === 'string' && v.trim()))].join(', ').slice(0, 160);
        return { lat: f.geometry.coordinates?.[1], lng: f.geometry.coordinates?.[0], name };
      });
    },
    async route(pickup, destination) {
      const url = new URL(`${routeUrl.href.replace(/\/$/, '')}/${pickup.lng},${pickup.lat};${destination.lng},${destination.lat}`);
      for (const [name, value] of Object.entries({ overview: 'full', geometries: 'geojson', steps: 'false', alternatives: 'false', radiuses: '250;250', generate_hints: 'false' })) url.searchParams.set(name, value);
      const result = await json(url, 'route', 5 * 60_000);
      check(result?.code === 'Ok' && result.routes?.[0]?.geometry?.type === 'LineString', 'INVALID_ROUTE', 'No drivable route was found. Move the pins closer to a road and retry.');
      const route = result.routes[0];
      return { distanceMeters: route.distance, durationSeconds: route.duration, coordinates: route.geometry.coordinates };
    },
    async pickupEstimates(pairs) {
      // One bounded OSRM table on the existing routing origin/profile. Custom
      // providers without the standard route path remain usable via route().
      check(Array.isArray(pairs) && pairs.length > 0 && pairs.length <= maxPickupPairs,
        'INVALID_ROUTE', `Pickup routing accepts up to ${maxPickupPairs} pairs at a time.`);
      const validPoint = (p) => p && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90
        && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180;
      check(pairs.every((pair) => validPoint(pair?.from) && validPoint(pair?.to)), 'INVALID_ROUTE', 'Pickup routing needs valid coordinates.');
      check(/\/route\/v1\/[^/]+\/?$/.test(routeUrl.pathname), 'MAPS_UNAVAILABLE', 'This route provider does not expose pickup tables.');
      const points = pairs.flatMap(({ from, to }) => [from, to]);
      const url = new URL(routeUrl);
      url.pathname = `${url.pathname.replace(/\/route\/v1\/([^/]+)\/?$/, '/table/v1/$1')}/${points.map((p) => `${p.lng},${p.lat}`).join(';')}`;
      for (const [name, value] of Object.entries({ sources: pairs.map((_, i) => i * 2).join(';'),
        destinations: pairs.map((_, i) => i * 2 + 1).join(';'), annotations: 'duration,distance',
        radiuses: points.map(() => '250').join(';'), generate_hints: 'false' })) url.searchParams.set(name, value);
      // Shares the route rate limit with previews; no fallback_speed is sent.
      const result = await json(url, 'route', 15_000);
      check(result?.code === 'Ok' && Array.isArray(result.durations) && Array.isArray(result.distances)
        && Array.isArray(result.sources) && Array.isArray(result.destinations), 'MAPS_UNAVAILABLE', 'Pickup routing returned an invalid table.');
      return pairs.map((_, i) => {
        const durationSeconds = result.durations[i]?.[i], distanceMeters = result.distances[i]?.[i];
        if (!Number.isFinite(durationSeconds) || !Number.isFinite(distanceMeters)
          || result.fallback_speed_cells?.some((cell) => Array.isArray(cell) && cell[0] === i && cell[1] === i)) return null;
        return { durationSeconds, distanceMeters, source: 'osrm-table',
          snappedFrom: result.sources[i]?.location, snappedTo: result.destinations[i]?.location };
      });
    },
  });
}
