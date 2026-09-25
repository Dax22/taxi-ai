/** Regions partition requests; nearby drivers are not cut off at a grid border. */
export function dispatchRegion(pickup, sampleAreaId) {
  if (pickup && Number.isFinite(pickup.lat) && Number.isFinite(pickup.lng)
    && pickup.lat >= 4 && pickup.lat < 14 && pickup.lng >= 2 && pickup.lng < 15) {
    return `ng:${Math.floor(pickup.lat * 20)}:${Math.floor(pickup.lng * 20)}`;
  }
  if (typeof sampleAreaId === 'string' && /^[a-z0-9-]{1,80}$/.test(sampleAreaId)) return `sample:${sampleAreaId}`;
  throw new Error('A dispatch region requires a Nigerian pickup or sample area.');
}
