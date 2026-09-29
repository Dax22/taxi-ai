import { isAbsolute } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { DEFAULT_DATABASE } from './database.mjs';

export function parseTesterAccess(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.testers) || !value.testers.length || value.testers.length > 50) {
    throw new Error('Staging access needs a version-one file with 1–50 testers.');
  }
  const testers = new Map();
  for (const row of value.testers) {
    if (!row || typeof row.name !== 'string' || !/^[a-z0-9_-]{3,40}$/.test(row.name)
      || typeof row.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.tokenHash) || testers.has(row.name)) {
      throw new Error('Invalid or duplicate staging tester entry.');
    }
    testers.set(row.name, row.tokenHash);
  }
  return testers;
}

export function createRuntimeConfig(env = process.env) {
  const mode = env.TAXI_AI_MODE ?? 'local';
  if (!['local', 'staging'].includes(mode) || (env.NODE_ENV === 'production' && mode !== 'staging')) {
    throw new Error('Use TAXI_AI_MODE=staging for hosted operation; local mode is development only.');
  }
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  if (mode === 'local') return Object.freeze({ mode, port, host: '127.0.0.1', database: env.TAXI_AI_DB ?? DEFAULT_DATABASE,
    publicOrigin: null, proxyToken: null, testers: new Map() });
  let origin;
  try { origin = new URL(env.TAXI_AI_PUBLIC_ORIGIN); } catch { throw new Error('Staging needs TAXI_AI_PUBLIC_ORIGIN as an HTTPS origin.'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || !origin.hostname.includes('.') || origin.hostname.endsWith('.') || isIP(origin.hostname.replace(/^\[|\]$/g, '')) || origin.hostname.endsWith('.localhost')) {
    throw new Error('Staging needs one HTTPS DNS origin, without credentials, path, query or fragment.');
  }
  if (!env.TAXI_AI_DATABASE_URL && (!env.TAXI_AI_DB || !isAbsolute(env.TAXI_AI_DB))) throw new Error('Staging needs TAXI_AI_DATABASE_URL or an absolute TAXI_AI_DB path on persistent storage.');
  if (!/^[a-f0-9]{64}$/.test(env.TAXI_AI_PROXY_TOKEN ?? '')) throw new Error('Staging needs a random 64-hex-character TAXI_AI_PROXY_TOKEN.');
  const file = env.TAXI_AI_STAGING_ACCESS_FILE;
  if (!file || !isAbsolute(file)) throw new Error('Staging needs an absolute TAXI_AI_STAGING_ACCESS_FILE.');
  let testers;
  try {
    const info = statSync(file);
    if (!info.isFile() || info.size > 16_384) throw new Error();
    testers = parseTesterAccess(JSON.parse(readFileSync(file, 'utf8')));
  } catch { throw new Error('Unable to load a valid staging tester access file.'); }
  const host = env.TAXI_AI_BIND ?? '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('TAXI_AI_BIND must be 127.0.0.1 or 0.0.0.0 on an isolated container network.');
  return Object.freeze({ mode, port, host, database: env.TAXI_AI_DB, publicOrigin: origin.origin,
    proxyToken: env.TAXI_AI_PROXY_TOKEN, testers });
}
