/** Emergency pause only affects new Eats quotes and placements. */
export function createEatsConfig(env = {}) {
  const setting = env.TAXI_AI_EATS_PAUSED ?? 'false';
  if (!['true', 'false'].includes(setting)) throw new Error('TAXI_AI_EATS_PAUSED must be true or false.');
  return Object.freeze({ paused: setting === 'true' });
}
