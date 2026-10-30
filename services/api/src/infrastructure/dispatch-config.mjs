/** Routing and offer allocation are independent of fare negotiation. */
export function createDispatchConfig(env = {}) {
  const mode = env.TAXI_AI_DISPATCH_MODE ?? 'sequential';
  if (!['legacy', 'sequential', 'batch'].includes(mode)) throw new Error('TAXI_AI_DISPATCH_MODE must be legacy, sequential or batch.');
  // Explicit kill-switch for performance canary and emergency rollback.
  const solver = env.TAXI_AI_BATCH_SOLVER ?? 'fast';
  if (!['fast', 'legacy'].includes(solver)) throw new Error('TAXI_AI_BATCH_SOLVER must be fast or legacy.');
  return Object.freeze({ mode, batchWindowMs: 2000, solver });
}
