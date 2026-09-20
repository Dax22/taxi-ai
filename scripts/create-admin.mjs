import { openDatabase } from '../services/api/src/infrastructure/database.mjs';
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
    db = openDatabase(createRuntimeConfig().database);
    const user = createApplication({ db }).accounts.bootstrapAdmin(process.argv[2]);
    console.log(`Administrator enabled for ${user.email}. Sign in at /admin on your Taxi Ai server.`);
    console.log('Driver applications use manual document review. The development preview does not contact external identity or vehicle registries.');
  } catch (error) {
    console.error(error instanceof ApplicationError ? error.message : 'Unable to open or update the local database. Check its path and permissions.');
    process.exitCode = 1;
  } finally { db?.close(); }
}
