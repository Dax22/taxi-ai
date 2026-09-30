/** Opt-in matching optimizations. Empty region selection means all regions. */
export function readMatchingFastConfig(env = {}) {
  const value = env.TAXI_AI_MATCHING_FAST_PATH ?? 'false';
  if (!['true', 'false'].includes(value)) throw new Error('TAXI_AI_MATCHING_FAST_PATH must be true or false.');
  const enabled = value === 'true';
  const selection = env.TAXI_AI_MATCHING_FAST_REGIONS;
  const regions = selection === undefined || selection.trim() === '' ? null : selection.split(',').map((id) => id.trim());
  if (regions && (regions.length > 256 || regions.some((id) => !/^(ng:\d{1,3}:\d{1,3}|sample:[a-z0-9-]{1,80})$/.test(id))
    || new Set(regions).size !== regions.length)) throw new Error('TAXI_AI_MATCHING_FAST_REGIONS must contain distinct matching region identifiers (maximum 256).');
  const selected = regions && new Set(regions);
  return Object.freeze({ enabled, regions: regions && Object.freeze(regions),
    includesRegion: (region) => enabled && (!selected || selected.has(region)) });
}
