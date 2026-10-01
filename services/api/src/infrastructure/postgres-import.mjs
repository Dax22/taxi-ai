import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { SCHEMA_VERSION } from './database.mjs';

const identifier = (value) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new TypeError('Unexpected snapshot identifier.');
  return `"${value}"`;
};
function* pages(source, table, limit = 100) {
  let cursor = null;
  const statement = source.prepare(`SELECT rowid AS __taxi_rowid,* FROM ${identifier(table)} WHERE (? IS NULL OR rowid>?) ORDER BY rowid LIMIT ?`);
  while (true) {
    const rows = statement.all(cursor, cursor, limit);
    if (!rows.length) return;
    yield rows;
    cursor = rows.at(-1).__taxi_rowid;
  }
}
const serializable = (_, value) => ArrayBuffer.isView(value) ? { bytes: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') } : value;

/** One consistent read-only source snapshot and one atomic target transaction.
 * An interrupted import leaves no partial rows; the same snapshot can be rerun.
 * Existing application data is never overwritten. Run before serving traffic. */
export async function importSqliteToPostgres(db, sourcePath, { onProgress = () => {} } = {}) {
  if (db.kind !== 'postgres') throw new TypeError('A PostgreSQL target is required.');
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    source.exec('PRAGMA query_only=ON; BEGIN;');
    const version = source.prepare('PRAGMA user_version').get().user_version;
    if (version !== SCHEMA_VERSION) throw new Error(`Snapshot schema ${version} is not current (${SCHEMA_VERSION}). Upgrade a working copy with this release before importing.`);
    const integrity = source.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || source.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Snapshot integrity check failed.');
    const tables = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
    const hash = createHash('sha256').update(`taxi-ai-sqlite:${version}\n`), counts = {};
    for (const table of tables) {
      const columns = source.prepare(`PRAGMA table_info(${identifier(table)})`).all().map((column) => column.name);
      hash.update(JSON.stringify({ table, columns })); counts[table] = 0;
      for (const rows of pages(source, table)) for (const row of rows) { hash.update(JSON.stringify(row, serializable)); counts[table]++; }
    }
    const sourceHash = hash.digest('hex');
    return await db.transaction(async () => {
      await db.query('SELECT pg_advisory_xact_lock(1867789123,702802)');
      const previous = await db.prepare('SELECT row_counts_json AS counts FROM taxi_import_history WHERE source_hash=?').get(sourceHash);
      if (previous) return { imported: false, alreadyImported: true, counts: JSON.parse(previous.counts) };
      await db.exec(`LOCK TABLE ${tables.map(identifier).join(',')} IN SHARE ROW EXCLUSIVE MODE`);
      for (const table of tables) {
        if ((await db.query(`SELECT EXISTS(SELECT 1 FROM ${identifier(table)}) AS present`)).rows[0].present) throw new Error(`PostgreSQL target table ${table} is not empty. Import into a new database.`);
      }
      await db.exec('SET CONSTRAINTS ALL DEFERRED');
      for (const table of tables) {
        const sourceColumns = source.prepare(`PRAGMA table_info(${identifier(table)})`).all().map((column) => column.name);
        const columns = table === 'guest_ride_links' ? [...sourceColumns, '_insert_order'] : sourceColumns;
        for (const rows of pages(source, table)) {
          const values = [], groups = rows.map((row) => {
            const cells = columns.map((column) => {
              let value = column === '_insert_order' ? row.__taxi_rowid : row[column];
              // A database transfer never transfers ownership of a live worker lease.
              if (table === 'worker_leases' && column === 'expires_at') value = 0;
              if (table === 'background_location_tokens' && column === 'expires_at') value = 0;
              if (table === 'eats_location_shares') {
                if (column === 'active') value = 0;
                if (['position_json','session_hash','client_hash'].includes(column)) value = null;
                if (column === 'stopped_at') value ??= Date.now();
              }
              if (ArrayBuffer.isView(value)) value = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
              values.push(value); return `$${values.length}`;
            });
            return `(${cells.join(',')})`;
          });
          // Domain triggers may already have advanced an account's cursor while
          // importing its history. Preserve the larger cursor, never move it back.
          const conflict = table === 'account_revisions' ? ` ON CONFLICT(user_id) DO UPDATE SET
            revision=GREATEST(account_revisions.revision,excluded.revision),updated_at=GREATEST(account_revisions.updated_at,excluded.updated_at)` : '';
          await db.query(`INSERT INTO ${identifier(table)}(${columns.map(identifier).join(',')}) VALUES ${groups.join(',')}${conflict}`, values);
        }
        onProgress({ table, rows: counts[table] });
      }
      // Force all foreign-key validation before recording success.
      await db.exec('SET CONSTRAINTS ALL IMMEDIATE');
      const identities = (await db.query(`SELECT table_name,column_name FROM information_schema.columns
        WHERE table_schema=$1 AND is_identity='YES'`, [db.schema])).rows;
      for (const { table_name: table, column_name: column } of identities) {
        await db.query(`SELECT setval(pg_get_serial_sequence($1,$2),COALESCE(MAX(${identifier(column)}),1),COUNT(*)>0) FROM ${identifier(table)}`, [`${db.schema}.${table}`, column]);
      }
      for (const table of tables.filter((name) => name !== 'account_revisions')) {
        const count = (await db.query(`SELECT count(*) AS count FROM ${identifier(table)}`)).rows[0].count;
        if (count !== counts[table]) throw new Error(`Imported row count differs for ${table}.`);
      }
      await db.prepare('INSERT INTO taxi_import_history(source_hash,source_schema,row_counts_json,completed_at) VALUES(?,?,?,?)')
        .run(sourceHash, version, JSON.stringify(counts), Date.now());
      return { imported: true, alreadyImported: false, counts };
    }, { retries: 0 });
  } finally {
    try { source.exec('ROLLBACK'); } finally { source.close(); }
  }
}
