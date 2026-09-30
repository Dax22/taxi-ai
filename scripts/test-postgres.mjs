import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { requireNativePostgres } from './postgres-test-server.mjs';
import { validateLoadPostgresUrl } from './load-test.mjs';

// Unlike the optional local suite, this entry point must never silently skip.
if (!process.env.TAXI_AI_TEST_POSTGRES_URL) throw new Error('Set TAXI_AI_TEST_POSTGRES_URL to a disposable loopback taxi_ai_test database.');
const connectionString = validateLoadPostgresUrl(process.env.TAXI_AI_TEST_POSTGRES_URL);
await requireNativePostgres(connectionString);
const files = (await readdir(new URL('../services/api/test/', import.meta.url)))
  .filter((name) => name.includes('postgres') && name.endsWith('.test.mjs')).sort()
  .map((name) => new URL(`../services/api/test/${name}`, import.meta.url).pathname);
const child = spawn(process.execPath, ['--experimental-sqlite', '--test', '--test-concurrency=1', ...files], { stdio: 'inherit', env: process.env });
const [code] = await once(child, 'exit');
process.exitCode = code ?? 1;
