import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { compilePostgresQuery } from './postgres-sql.mjs';

export const POSTGRES_MIGRATIONS = ['001_baseline.sql', '002_scale.sql', '003_family_safety.sql', '004_family_delivery.sql', '005_staff_access.sql', '006_admin_cases.sql', '007_admin_operations.sql', '008_admin_compliance.sql', '009_driver_face_checks.sql', '010_parcel_tracking.sql', '011_admin_announcements.sql', '012_kemmy_setup.sql'];
export const POSTGRES_SCHEMA_VERSION = POSTGRES_MIGRATIONS.length;
const safeNumber = (value) => {
  const result = Number(value);
  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER) throw new RangeError('Database number exceeds the safe application range.');
  return result;
};
const queryTypes = { getTypeParser(oid, format) {
  return format !== 'binary' && [20, 1700].includes(oid) ? safeNumber : pg.types.getTypeParser(oid, format);
} };
const schemaName = (value) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new TypeError('Invalid PostgreSQL schema name.');
  return value;
};
const integer = (value, fallback, min, max, label) => {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < min || number > max) throw new TypeError(`Invalid ${label}.`);
  return number;
};

/** Native pooled asynchronous PostgreSQL. No synchronous RPC, local replica or
 * global connection: each transaction pins one pool client across all awaits. */
export async function openPostgresDatabase({
  connectionString = process.env.TAXI_AI_DATABASE_URL,
  max = process.env.TAXI_AI_DATABASE_POOL_SIZE,
  schema = process.env.TAXI_AI_DATABASE_SCHEMA ?? 'public',
  ssl,
  migrate = false,
  verify = true,
  onError = () => {},
} = {}) {
  if (!connectionString) throw new TypeError('TAXI_AI_DATABASE_URL is required for PostgreSQL.');
  schema = schemaName(schema);
  const pool = new pg.Pool({ connectionString, max: integer(max, 10, 1, 100, 'database pool size'),
    connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 15000, lock_timeout: 5000, idle_in_transaction_session_timeout: 30000,
    application_name: 'taxi-ai', options: `-c search_path=${schema},public`, ...(ssl === undefined ? {} : { ssl }) });
  pool.on('error', onError);
  const context = new AsyncLocalStorage(); let closed = false, savepoint = 0;
  const initialized = new WeakSet();
  const activeContext = () => context.getStore()?.active ? context.getStore() : null;
  const checkQueue = () => { if (pool.waitingCount >= 1000) throw new Error('Database connection queue is full.'); };
  const acquire = async () => {
    checkQueue();
    const client = await pool.connect();
    try {
      if (!initialized.has(client)) {
        await client.query(`SET search_path TO "${schema}",public`);
        initialized.add(client);
      }
      return client;
    } catch (error) { client.release(error); throw error; }
  };
  const query = async (text, values = []) => {
    if (closed) throw new Error('Database is closed.');
    const scope = activeContext();
    if (scope) return scope.client.query({ text, values, types: queryTypes });
    const client = await acquire();
    try { return await client.query({ text, values, types: queryTypes }); }
    finally { client.release(); }
  };
  const db = {
    kind: 'postgres', schema,
    query,
    prepare(source) {
      const run = (args, identity = false) => { const compiled = compilePostgresQuery(source, args, { identity }); return query(compiled.text, compiled.values); };
      return Object.freeze({
        async get(...args) { return (await run(args)).rows[0]; },
        async all(...args) { return (await run(args)).rows; },
        async run(...args) { const result = await run(args, true); return { changes: result.rowCount ?? 0, lastInsertRowid: result.rows[0]?.id ?? 0 }; },
      });
    },
    async exec(sql) { return query(sql); },
    async transaction(callback, { retries = 3, isolation = 'SERIALIZABLE' } = {}) {
      if (!['SERIALIZABLE', 'REPEATABLE READ', 'READ COMMITTED'].includes(isolation)) throw new TypeError('Invalid transaction isolation.');
      const current = activeContext();
      if (current) {
        const name = `taxi_nested_${++savepoint}`;
        const nested = { client: current.client, active: true };
        await current.client.query(`SAVEPOINT ${name}`);
        try { const result = await context.run(nested, callback); nested.active = false; await current.client.query(`RELEASE SAVEPOINT ${name}`); return result; }
        catch (error) { nested.active = false; await current.client.query(`ROLLBACK TO SAVEPOINT ${name}`); throw error; }
      }
      for (let attempt = 0; ; attempt++) {
        if (closed) throw new Error('Database is closed.');
        checkQueue();
        const client = await acquire();
        const scope = { client, active: true };
        try {
          await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
          const result = await context.run(scope, callback);
          scope.active = false;
          await client.query('COMMIT');
          return result;
        } catch (error) {
          scope.active = false;
          try { await client.query('ROLLBACK'); } catch { /* Original error is more useful. */ }
          if (!['40001', '40P01'].includes(error.code) || attempt >= retries) throw error;
        } finally { client.release(); }
      }
    },
    async healthy() {
      try {
        const result = await query('SELECT max(version) AS version FROM taxi_schema_migrations');
        return result.rows[0]?.version === POSTGRES_SCHEMA_VERSION;
      } catch { return false; }
    },
    stats: () => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }),
    async close() { if (!closed) { closed = true; await pool.end(); } },
  };
  try {
    await query('SELECT 1');
    if (migrate) await migratePostgres(db);
    else if (verify && !await db.healthy()) throw new Error('PostgreSQL schema is not current. Run npm run db:postgres:migrate before starting the application.');
    return Object.freeze(db);
  } catch (error) { await db.close(); throw error; }
}

/** Run explicitly during deployment, with a migration role authorized to create
 * PostGIS/citext. Ordinary web/worker startup only verifies the schema. */
export async function migratePostgres(db) {
  return db.transaction(async () => {
    await db.query('SELECT pg_advisory_xact_lock(1867789123, 702801)');
    await db.query('CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public');
    await db.query('CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public');
    await db.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName(db.schema)}"`);
    await db.query(`CREATE TABLE IF NOT EXISTS taxi_schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, checksum TEXT NOT NULL, applied_at BIGINT NOT NULL)`);
    const applied = (await db.query('SELECT version,name,checksum FROM taxi_schema_migrations ORDER BY version')).rows;
    if (applied.some((row) => row.version > POSTGRES_SCHEMA_VERSION)) throw new Error('This PostgreSQL database requires a newer Taxi AI release.');
    for (let index = 0; index < POSTGRES_MIGRATIONS.length; index++) {
      const name = POSTGRES_MIGRATIONS[index], version = index + 1;
      const sql = await readFile(new URL(`../../migrations/postgres/${name}`, import.meta.url), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex'), previous = applied.find((row) => row.version === version);
      if (previous) {
        if (previous.name !== name || previous.checksum !== checksum) throw new Error(`PostgreSQL migration ${version} has changed since it was applied.`);
        continue;
      }
      await db.exec(sql);
      await db.query('INSERT INTO taxi_schema_migrations(version,name,checksum,applied_at) VALUES($1,$2,$3,$4)', [version, name, checksum, Date.now()]);
    }
    return { version: POSTGRES_SCHEMA_VERSION };
  }, { retries: 0 });
}
