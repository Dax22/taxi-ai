import { randomUUID } from 'node:crypto';
import { readMatchingFastConfig } from './matching-fast-config.mjs';

function integer(value, fallback, name, minimum, maximum) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  return parsed;
}

/** One configuration vocabulary for embedded development and split deployments. */
export function createWorkerConfig(env = {}) {
  const role = env.TAXI_AI_PROCESS_ROLE ?? 'all';
  if (!['all', 'api', 'worker'].includes(role)) throw new Error('TAXI_AI_PROCESS_ROLE must be all, api or worker.');
  const ownerId = env.TAXI_AI_WORKER_ID ?? randomUUID();
  if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(ownerId)) throw new Error('TAXI_AI_WORKER_ID must be a short identifier.');
  const regionSetting = env.TAXI_AI_WORKER_REGIONS ?? 'auto';
  const regions = regionSetting === 'auto' ? null : regionSetting.split(',').map((value) => value.trim());
  if (regions && (!regions.length || regions.length > 256 || regions.some((id) => !/^(ng:\d{1,3}:\d{1,3}|sample:[a-z0-9-]{1,80})$/.test(id))
    || new Set(regions).size !== regions.length)) throw new Error('TAXI_AI_WORKER_REGIONS needs auto or distinct geographic region identifiers.');
  return Object.freeze({ role, ownerId, matchingFast: readMatchingFastConfig(env), regions: regions && Object.freeze(regions),
    concurrency: integer(env.TAXI_AI_WORKER_CONCURRENCY, 4, 'TAXI_AI_WORKER_CONCURRENCY', 1, 32),
    leaseMs: integer(env.TAXI_AI_WORKER_LEASE_MS, 15_000, 'TAXI_AI_WORKER_LEASE_MS', 5000, 120_000),
    intervalMs: integer(env.TAXI_AI_WORKER_INTERVAL_MS, 2000, 'TAXI_AI_WORKER_INTERVAL_MS', 250, 10_000),
    shutdownMs: integer(env.TAXI_AI_WORKER_SHUTDOWN_MS, 20_000, 'TAXI_AI_WORKER_SHUTDOWN_MS', 1000, 60_000) });
}

export { dispatchRegion } from '../shared/dispatch-region.mjs';
