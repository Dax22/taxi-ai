import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Mounted inside the existing app image; dependencies remain in /app/node_modules.
const require = createRequire('/app/package.json');
const { Client } = require('pg');
const role = process.argv[2];
if (!['api', 'worker', 'migrate', 'check', 'config', 'admin'].includes(role)
    || (role === 'admin' ? process.argv.length !== 4 : process.argv.length !== 3)) {
  console.error('Usage: deploy-launch.mjs api|worker|migrate|check|config OR admin EMAIL');
  process.exit(1);
}

const migrate = role === 'migrate';
let connectionString;
try {
  const password = readFileSync(`/run/secrets/${migrate ? 'owner' : 'app'}_password`, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(password)) throw new Error('invalid password file');
  connectionString = `postgresql://${migrate ? 'taxi_owner' : 'taxi_app'}:${password}@postgres:5432/taxi_ai`;
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000, query_timeout: 10_000 });
  try {
    await client.connect();
    const result = await client.query("SELECT pg_is_in_recovery() AS recovering, current_setting('transaction_read_only') AS read_only");
    if (result.rows[0]?.recovering !== false || result.rows[0]?.read_only !== 'off') {
      throw new Error('database is a standby or read-only');
    }
  } finally {
    await client.end();
  }
} catch {
  // Never stringify driver errors, environment, or a credential-bearing URL.
  console.error('Startup refused: local database must be reachable, writable, and out of recovery. Fence the old primary before manual promotion.');
  process.exit(1);
}

if (role === 'check') {
  console.log('Local database is writable and not in recovery.');
  process.exit(0);
}

const env = { ...process.env, TAXI_AI_DATABASE_URL: connectionString, TAXI_AI_MODE: 'staging' };
if (!migrate) env.TAXI_AI_PROCESS_ROLE = role === 'worker' ? 'worker' : 'api';
const commands = {
  migrate: ['scripts/postgres-migrate.mjs', '--grant-app-role', 'taxi_app'],
  api: ['apps/web/server.mjs'],
  worker: ['apps/web/server.mjs'],
  config: ['scripts/config-check.mjs'],
  admin: ['scripts/create-admin.mjs', process.argv[3]],
};
const args = ['--experimental-sqlite', ...commands[role]];
const child = spawn(process.execPath, args, { cwd: '/app', env, stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('Could not start application process.'); process.exit(1); });
child.on('exit', (code, signal) => process.exit(code ?? (signal === 'SIGTERM' ? 143 : 1)));
