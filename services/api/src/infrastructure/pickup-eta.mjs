// Dispatch reuses the configured road router. Missing or unusable road data is
// explicitly unavailable: this adapter never turns straight-line distance into
// an ETA. Coordinates stay in this bounded, short-lived process cache only.
const point = (value) => value && Number.isFinite(value.lat) && Number.isFinite(value.lng)
  && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180;
const distance = (a, b) => {
  const radians = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * radians / 2) ** 2
    + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin((b.lng - a.lng) * radians / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
};
function validRoute(raw, from, to) {
  if (!raw || raw.source === 'direct' || raw.distanceKind === 'straight_line') return false;
  const { durationSeconds: seconds, distanceMeters: metres } = raw;
  // OSRM table returns road metrics with snapped endpoints, not route geometry.
  const coordinates = raw.source === 'osrm-table' ? [raw.snappedFrom, raw.snappedTo] : raw.coordinates;
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 14_400
    || !Number.isFinite(metres) || metres < 0 || metres > 120_000
    || !Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 20_000) return false;
  const geometry = [];
  for (const item of coordinates) {
    if (!Array.isArray(item) || item.length !== 2 || !point({ lat: item[1], lng: item[0] })) return false;
    geometry.push({ lat: item[1], lng: item[0] });
  }
  if (distance(from, geometry[0]) > 350 || distance(to, geometry.at(-1)) > 350) return false;
  let geometryMetres = 0;
  for (let i = 1; i < geometry.length; i += 1) geometryMetres += distance(geometry[i - 1], geometry[i]);
  return metres >= Math.max(0, geometryMetres * 0.8 - 50, distance(from, to) - 700)
    && (metres === 0 || (seconds > 0 && metres / seconds <= 70));
}
function boundedInteger(value, name, low, high) {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw new Error(`${name} is outside the supported pickup ETA limits.`);
  return value;
}

export function createPickupEtaProvider({ mapProvider, now = Date.now, cacheMs = 15_000,
  failureCacheMs = 1500, maxCacheEntries = 256, maxConcurrent = 2, timeoutMs = 1500 } = {}) {
  boundedInteger(cacheMs, 'cacheMs', 1, 60_000);
  boundedInteger(failureCacheMs, 'failureCacheMs', 1, 10_000);
  boundedInteger(maxCacheEntries, 'maxCacheEntries', 1, 1024);
  boundedInteger(maxConcurrent, 'maxConcurrent', 1, 8);
  boundedInteger(timeoutMs, 'timeoutMs', 1, 8000);
  const cache = new Map(), pending = new Map();
  let active = 0;
  const remember = (key, value) => {
    const at = now();
    for (const [savedKey, entry] of cache) if (entry.until <= at) cache.delete(savedKey);
    if (cache.size >= maxCacheEntries) cache.delete(cache.keys().next().value);
    cache.set(key, { value, until: at + (value ? cacheMs : failureCacheMs) });
  };
  const edge = (pair) => {
    if (!point(pair?.from) || !point(pair?.to)) return null;
    const from = { lat: pair.from.lat, lng: pair.from.lng }, to = { lat: pair.to.lat, lng: pair.to.lng };
    return { from, to, key: `${from.lat},${from.lng}:${to.lat},${to.lng}` };
  };
  const clone = (value) => value ? { ...value } : null;
  const remembered = (key) => cache.get(key)?.until > now() ? { value: clone(cache.get(key).value) } : null;
  function start(edges, request) {
    active += 1;
    let timer, timedOut = false;
    const unavailable = () => edges.map(() => null);
    const task = Promise.resolve().then(request).then((raws) => edges.map(({ from, to }, i) => {
      const raw = raws?.[i];
      if (timedOut || !validRoute(raw, from, to)) return null;
      return { durationSeconds: Math.ceil(raw.durationSeconds), distanceMeters: Math.ceil(raw.distanceMeters),
        source: 'road', trafficAware: false, estimatedAt: now() };
    })).catch(unavailable).finally(() => {
      // A timed-out upstream still occupies its slot until it actually settles,
      // preventing an unresponsive adapter from accumulating background work.
      active -= 1;
      if (timedOut) for (const { key } of edges) pending.delete(key);
    });
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => { timedOut = true; resolve(unavailable()); }, timeoutMs);
    });
    const resultTask = Promise.race([task, timeout]).then((values) => {
      clearTimeout(timer);
      edges.forEach(({ key }, i) => {
        remember(key, values[i]);
        if (!timedOut) pending.delete(key);
      });
      return values;
    });
    edges.forEach(({ key }, i) => pending.set(key, resultTask.then((values) => values[i])));
    return resultTask;
  }
  async function estimate(pair) {
    const candidate = edge(pair);
    if (!candidate || typeof mapProvider?.route !== 'function' || mapProvider.mode === 'off') return null;
    const saved = remembered(candidate.key);
    if (saved) return saved.value;
    if (pending.has(candidate.key)) return clone(await pending.get(candidate.key));
    // Do not queue unbounded pair matrices, or bypass the router's own shared
    // rate limit. Dispatch can use its explicit proximity fallback this cycle.
    if (active >= maxConcurrent) return null;
    const values = await start([candidate], async () => [await mapProvider.route(candidate.from, candidate.to)]);
    return clone(values[0]);
  }
  async function estimateMany(pairs) {
    if (!Array.isArray(pairs)) return [];
    if (typeof mapProvider?.pickupEstimates !== 'function') return Promise.all(pairs.map(estimate));
    if (mapProvider.mode === 'off') return pairs.map(() => null);
    const edges = pairs.map(edge), requested = new Map();
    const maxPairs = Math.min(64, Math.max(1, mapProvider.maxPickupPairs ?? 16));
    for (const item of edges) if (item && !remembered(item.key) && !pending.has(item.key) && requested.size < maxPairs) requested.set(item.key, item);
    let batch;
    if (requested.size && active < maxConcurrent) {
      const selected = [...requested.values()];
      batch = start(selected, () => mapProvider.pickupEstimates(selected.map(({ from, to }) => ({ from, to }))));
    }
    const waiting = edges.map((item) => item && pending.get(item.key));
    await batch;
    return Promise.all(edges.map(async (item, i) => {
      if (!item) return null;
      if (waiting[i]) return clone(await waiting[i]);
      return remembered(item.key)?.value ?? null;
    }));
  }
  return Object.freeze({ estimate, estimateMany });
}
