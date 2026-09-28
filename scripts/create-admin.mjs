import { openDatabase } from '../services/api/src/infrastructure/database.mjs';
import { openPostgresDatabase } from '../services/api/src/infrastructure/postgres.mjs';
import { createApplication } from '../services/api/src/application.mjs';
import { ApplicationError } from '../services/api/src/shared/errors.mjs';
import { createRuntimeConfig } from '../services/api/src/infrastructure/runtime-config.mjs';

if (process.argv.length !== 3) {
  console.error('Usage: npm run admin -- your-admin-email@example.com');
  console.error('Register a separate customer account at /app first. This command grants it the first administrator role.');
  process.exitCode = 1;
} else {
  let db;
  try {
    const runtime = createRuntimeConfig();
    db = process.env.TAXI_AI_DATABASE_URL ? await openPostgresDatabase() : openDatabase(runtime.database);
    const user = (await createApplication({ db }).accounts.bootstrapAdmin(process.argv[2]));
    console.log(`Administrator enabled for ${user.email}. Sign in at /admin on your Taxi Ai server.`);
    console.log('Driver applications use manual document review. The development preview does not contact external identity or vehicle registries.');
  } catch (error) {
    console.error(error instanceof ApplicationError ? error.message : 'Unable to open or update the local database. Check its path and permissions.');
    process.exitCode = 1;
  } finally { await db?.close(); }
}
