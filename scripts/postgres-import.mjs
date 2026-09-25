import { resolve } from 'node:path';
import { openPostgresDatabase } from '../services/api/src/infrastructure/postgres.mjs';
import { importSqliteToPostgres } from '../services/api/src/infrastructure/postgres-import.mjs';

const args = process.argv.slice(2);
if (args.length !== 1 || args[0].startsWith('-')) throw new Error('Usage: npm run db:postgres:import -- /absolute/path/to/current-snapshot.sqlite');
const db = await openPostgresDatabase({ max: 1 });
try {
  const result = await importSqliteToPostgres(db, resolve(args[0]));
  console.log(JSON.stringify({ event: 'postgres_import_complete', ...result }));
} finally { await db.close(); }
