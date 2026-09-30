import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openPostgresDatabase } from '../services/api/src/infrastructure/postgres.mjs';
import { validateLoadPostgresUrl } from './load-test.mjs';

// Unlike the optional local suite, this entry point must never silently skip.
const connectionString = validateLoadPostgresUrl(process.env.TAXI_AI_TEST_POSTGRES_URL);
const clients = [];
try {
  for (let i = 0; i < 2; i++) clients.push(await openPostgresDatabase({ connectionString, max: 1, verify: false }));
  const identities = await Promise.all(clients.map((db) => db.query('SELECT pg_backend_pid() AS pid,version() AS version')));
  if (identities[0].rows[0].pid === identities[1].rows[0].pid || identities.some((r) => !/^PostgreSQL (1[6-9]|[2-9]\d)\./.test(r.rows[0].version))) {
    throw new Error('The required database gate needs native PostgreSQL 16+ with independent backends.');
  }
} finally { await Promise.all(clients.map((db) => db.close())); }
const files = (await readdir(new URL('../services/api/test/', import.meta.url)))
  .filter((name) => name.includes('postgres') && name.endsWith('.test.mjs')).sort()
  .map((name) => new URL(`../services/api/test/${name}`, import.meta.url).pathname);
const child = spawn(process.execPath, ['--experimental-sqlite', '--test', '--test-concurrency=1', ...files], { stdio: 'inherit', env: process.env });
const [code] = await once(child, 'exit');
process.exitCode = code ?? 1;
