import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

const phases = ['discovery', 'routing', 'commit'];
const round = (n) => Math.round(n * 100) / 100;

/** Opt-in, bounded measurements. Never retain SQL, arguments, account IDs or regions. */
export function createDispatchProfiler({ sampleEvery = 0, report = () => {}, now = () => performance.now() } = {}) {
  if (!Number.isInteger(sampleEvery) || sampleEvery < 0 || sampleEvery > 10000) throw new TypeError('Dispatch profile sampling must be an integer from 0 to 10000.');
  const context = new AsyncLocalStorage();
  let sequence = 0;
  const current = () => { const scope = context.getStore(); return scope?.active ? scope : null; };
  async function query(key, action) {
    const scope = current();
    if (!scope) return action();
    const started = now(); let failed = false;
    try { return await action(); } catch (error) { failed = true; throw error; }
    finally {
      if (scope.active) {
        const elapsed = Math.max(0, now() - started);
        scope.queryCount++; scope.queryMs += elapsed; scope.queryErrors += Number(failed);
        const bucket = scope.queries.has(key) || scope.queries.size < 64 ? key : 'overflow';
        const row = scope.queries.get(bucket) ?? { count: 0, totalMs: 0, maxMs: 0, errors: 0 };
        row.count++; row.totalMs += elapsed; row.maxMs = Math.max(row.maxMs, elapsed); row.errors += Number(failed);
        scope.queries.set(bucket, row);
      }
    }
  }
  const fingerprint = (sql, method) => createHash('sha256').update(`${method}:${sql.replace(/\s+/g, ' ').trim()}`).digest('hex').slice(0, 16);
  return Object.freeze({
    wrap(db) {
      if (!sampleEvery) return db;
      return Object.freeze({ ...db,
        prepare(sql) {
          const statement = db.prepare(sql);
          return Object.fromEntries(['get', 'all', 'run'].map((method) => {
            const key = fingerprint(sql, method);
            return [method, (...args) => query(key, () => statement[method](...args))];
          }));
        },
        exec: (sql) => query(fingerprint(sql, 'exec'), () => db.exec(sql)),
        ...(db.query ? { query: (sql, values) => query(fingerprint(sql, 'query'), () => db.query(sql, values)) } : {}),
        transaction: (callback, options) => {
          const scope = current(); let attempts = 0;
          if (scope) scope.transactions++;
          return db.transaction(() => {
            if (scope?.active && attempts++ > 0) scope.retries++;
            return callback();
          }, options);
        },
      });
    },
    async cycle(action) {
      if (!sampleEvery || sequence++ % sampleEvery) return action();
      const scope = { active: true, queryCount: 0, queryMs: 0, queryErrors: 0, transactions: 0, retries: 0, queries: new Map(), phases: {} };
      const started = now(); let failed = false;
      try { return await context.run(scope, action); } catch (error) { failed = true; throw error; }
      finally {
        scope.active = false;
        const value = { durationMs: round(Math.max(0, now() - started)), failed, sampleEvery,
          queryCount: scope.queryCount, queryMs: round(scope.queryMs), queryErrors: scope.queryErrors,
          transactions: scope.transactions, retries: scope.retries, phases: scope.phases,
          queries: [...scope.queries].map(([fingerprint, row]) => ({ fingerprint, ...row, totalMs: round(row.totalMs), maxMs: round(row.maxMs) })) };
        try { void Promise.resolve(report(value)).catch(() => {}); } catch { /* Telemetry must not change dispatch outcomes. */ }
      }
    },
    async phase(name, action) {
      const scope = current();
      if (!scope || !phases.includes(name)) return action();
      const started = now();
      try { return await action(); }
      finally { if (scope.active) scope.phases[name] = round((scope.phases[name] ?? 0) + Math.max(0, now() - started)); }
    },
  });
}
