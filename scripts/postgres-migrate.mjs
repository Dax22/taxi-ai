import { openPostgresDatabase, POSTGRES_SCHEMA_VERSION } from '../services/api/src/infrastructure/postgres.mjs';

const args = process.argv.slice(2);
const role = args[0] === '--grant-app-role' && args.length === 2 ? args[1] : null;
if (args.length && !role) throw new Error('Usage: npm run db:postgres:migrate -- [--grant-app-role taxi_app]');
if (role && !/^[a-z_][a-z0-9_]{0,62}$/.test(role)) throw new Error('Invalid application role name.');
const db = await openPostgresDatabase({ migrate: true });
try {
  if (role) await db.transaction(async () => {
    const schema = `"${db.schema}"`, quotedRole = `"${role}"`;
    await db.query(`GRANT USAGE ON SCHEMA ${schema} TO ${quotedRole}`);
    await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${quotedRole}`);
    await db.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${quotedRole}`);
    await db.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${quotedRole}`);
    await db.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT USAGE,SELECT ON SEQUENCES TO ${quotedRole}`);
    // Application startup may read the migration ledger, but never alter it.
    await db.query(`REVOKE INSERT,UPDATE,DELETE ON taxi_schema_migrations FROM ${quotedRole}`);
  });
  console.log(JSON.stringify({ event: 'postgres_migrated', version: POSTGRES_SCHEMA_VERSION, applicationRoleGranted: Boolean(role) }));
} finally { await db.close(); }
