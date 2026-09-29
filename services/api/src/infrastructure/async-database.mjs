import { AsyncLocalStorage } from 'node:async_hooks';

const adapters = new WeakMap();

/** Local SQLite compatibility. A whole async transaction owns the connection;
 * unrelated requests cannot accidentally execute inside that transaction. */
export function asAsyncDatabase(database) {
  if (database.kind === 'postgres' || database.kind === 'sqlite') return database;
  if (adapters.has(database)) return adapters.get(database);
  const context = new AsyncLocalStorage();
  let tail = Promise.resolve(), savepoint = 0;
  function enqueue(run) {
    if (context.getStore()?.active) return Promise.resolve().then(run);
    const result = tail.then(run);
    tail = result.catch(() => {});
    return result;
  }
  const adapter = Object.freeze({
    kind: 'sqlite',
    prepare(sql) {
      return Object.freeze(Object.fromEntries(['get', 'all', 'run'].map((method) =>
        [method, (...args) => enqueue(() => database.prepare(sql)[method](...args))])));
    },
    exec: (sql) => enqueue(() => database.exec(sql)),
    transaction(run) {
      const nested = context.getStore()?.active;
      return enqueue(async () => {
        const name = nested ? `nested_${++savepoint}` : null;
        database.exec(name ? `SAVEPOINT ${name}` : 'BEGIN IMMEDIATE');
        const scope = { active: true };
        try {
          const result = await context.run(scope, run);
          database.exec(name ? `RELEASE SAVEPOINT ${name}` : 'COMMIT');
          return result;
        } catch (error) {
          database.exec(name ? `ROLLBACK TO SAVEPOINT ${name}` : 'ROLLBACK');
          if (name) database.exec(`RELEASE SAVEPOINT ${name}`);
          throw error;
        } finally { scope.active = false; }
      });
    },
    close: () => enqueue(() => database.close()),
  });
  adapters.set(database, adapter);
  return adapter;
}
