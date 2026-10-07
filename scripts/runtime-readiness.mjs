import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const mode = (value, allowed) => allowed.includes(value) ? value : 'unavailable';
export function describeConfiguration(env) {
  return {
    access: mode(env.TAXI_AI_ACCESS_MODE, ['public', 'invited']),
    passengerRidesPaused: env.TAXI_AI_RIDES_PAUSED === 'true' ? true : env.TAXI_AI_RIDES_PAUSED === 'false' ? false : null,
    coverage: mode(env.TAXI_AI_RIDE_COVERAGE ?? 'pilot', ['pilot', 'nigeria']),
    pilotBoundsPresent: Boolean(env.TAXI_AI_RIDE_PILOT_BOUNDS),
    maps: mode(env.TAXI_AI_MAPS_MODE, ['off', 'community', 'dedicated']),
    calls: mode(env.TAXI_AI_CALLS_MODE, ['off', 'local', 'relay']),
    turnUrlsPresent: Boolean(env.TAXI_AI_TURN_URLS),
    turnSecretPresent: Boolean(env.TAXI_AI_TURN_SECRET),
    paymentProvider: mode(env.TAXI_AI_PAYMENT_PROVIDER, ['off', 'paystack_test', 'paystack_live']),
    email: mode(env.TAXI_AI_EMAIL_MODE, ['off', 'smtp']),
  };
}
export async function collectCounts(query, now = Date.now()) {
  const queries = {
    registeredDriverProfiles: "SELECT COUNT(*) AS n FROM drivers d WHERE EXISTS (SELECT 1 FROM account_capabilities c WHERE c.user_id=d.user_id AND c.capability='driver')",
    approvedDriverProfiles: "SELECT COUNT(*) AS n FROM drivers d WHERE d.status='approved' AND EXISTS (SELECT 1 FROM account_capabilities c WHERE c.user_id=d.user_id AND c.capability='driver')",
    submittedDriverApplications: "SELECT COUNT(*) AS n FROM driver_applications WHERE status='submitted'",
    freshGpsAvailabilityLeases: `SELECT COUNT(*) AS n FROM driver_availability WHERE active=1 AND mode='gps' AND expires_at>${Math.trunc(now)}`,
    waitingRideRequests: `SELECT COUNT(*) AS n FROM rides WHERE status='requested' AND request_expires_at>${Math.trunc(now)}`,
  };
  const result = {};
  for (const [name, sql] of Object.entries(queries)) {
    const rows = await query(sql), count = Number(rows[0]?.n);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('INVALID_COUNT');
    result[name] = count;
  }
  return result;
}
export async function main(env = process.env) {
  const report = { checkedAt: new Date().toISOString(), configuration: describeConfiguration(env), counts: null,
    note: 'Aggregate stored counts only. Approval is not current document eligibility; a fresh GPS lease is not proof of an eligible nearby driver. No location or personal data is printed.' };
  let close = async () => {};
  try {
    const require = createRequire(resolve(process.cwd(), 'package.json'));
    let query;
    if (env.TAXI_AI_DATABASE_URL) {
      const { Client } = require('pg');
      const schema = env.TAXI_AI_DATABASE_SCHEMA ?? 'public';
      if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error('INVALID_SCHEMA');
      const client = new Client({ connectionString: env.TAXI_AI_DATABASE_URL, connectionTimeoutMillis: 5000,
        statement_timeout: 5000, application_name: 'taxi-ai-readonly-readiness',
        options: `-c default_transaction_read_only=on -c search_path=${schema},public` });
      close = async () => { try { await client.query('ROLLBACK'); } finally { await client.end(); } };
      await client.connect();
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      query = async sql => (await client.query(sql)).rows;
      report.storage = 'postgres';
    } else {
      if (!env.TAXI_AI_DB) throw new Error('DB_PATH_UNAVAILABLE');
      const { DatabaseSync } = await import('node:sqlite');
      const db = new DatabaseSync(env.TAXI_AI_DB, { readOnly: true });
      close = async () => db.close();
      db.exec('PRAGMA query_only=ON; BEGIN;');
      query = async sql => db.prepare(sql).all();
      report.storage = 'sqlite';
    }
    report.counts = await collectCounts(query);
    report.databaseRead = 'ok';
  } catch { report.databaseRead = 'unavailable'; }
  finally { try { await close(); } catch { report.databaseRead = 'unavailable'; } }
  console.log(JSON.stringify(report, null, 2));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
