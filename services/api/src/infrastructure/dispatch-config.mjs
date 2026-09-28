/** Routing and offer allocation are independent of fare negotiation. */
export function createDispatchConfig(env = {}) {
  const mode = env.TAXI_AI_DISPATCH_MODE ?? 'sequential';
  if (!['legacy', 'sequential', 'batch'].includes(mode)) throw new Error('TAXI_AI_DISPATCH_MODE must be legacy, sequential or batch.');
  return Object.freeze({ mode, batchWindowMs: 2000 });
}
