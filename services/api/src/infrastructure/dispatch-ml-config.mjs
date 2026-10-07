const REGION = /^(ng:\d{1,3}:\d{1,3}|sample:[a-z0-9-]{1,80})$/;

export function readDispatchMlConfig(env = {}) {
  const mode = env.TAXI_AI_ML_RANKING_MODE ?? 'off';
  if (!['off','shadow','live'].includes(mode)) throw new Error('TAXI_AI_ML_RANKING_MODE must be off, shadow or live.');
  const model = env.TAXI_AI_ML_RANKING_MODEL ?? 'bootstrap-shadow-v1';
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(model)) throw new Error('Invalid TAXI_AI_ML_RANKING_MODEL.');
  const raw = env.TAXI_AI_ML_RANKING_REGIONS;
  const regions = raw === undefined || raw.trim() === '' ? null : raw.split(',').map(value => value.trim());
  if (regions && (regions.length > 256 || regions.some(value => !REGION.test(value)) || new Set(regions).size !== regions.length)) {
    throw new Error('TAXI_AI_ML_RANKING_REGIONS must contain distinct region identifiers (maximum 256).');
  }
  const retentionDays = env.TAXI_AI_ML_RANKING_RETENTION_DAYS === undefined ? 30 : Number(env.TAXI_AI_ML_RANKING_RETENTION_DAYS);
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 7 || retentionDays > 180) throw new Error('TAXI_AI_ML_RANKING_RETENTION_DAYS must be 7–180.');
  if (mode === 'live' && env.TAXI_AI_ML_RANKING_LIVE_ENABLED !== 'true') {
    throw new Error('Live ML ranking requires TAXI_AI_ML_RANKING_LIVE_ENABLED=true.');
  }
  const selected = regions && new Set(regions);
  return Object.freeze({ mode, model, retentionDays, regions: regions && Object.freeze(regions),
    includesRegion: region => mode !== 'off' && (!selected || selected.has(region)) });
}
