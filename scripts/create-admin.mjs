import { openDatabase } from '../services/api/src/infrastructure/database.mjs';
import { createApplication } from '../services/api/src/application.mjs';
import { ApplicationError } from '../services/api/src/shared/errors.mjs';

if (process.argv.length !== 3) {
  console.error('Usage: npm run admin -- your-admin-email@example.com');
  console.error('Register a separate customer account at /app first. This command grants it the first administrator role.');
  process.exitCode = 1;
} else {
  let db;
  try {
    db = openDatabase();
    const user = createApplication({ db }).accounts.bootstrapAdmin(process.argv[2]);
    console.log(`Administrator enabled for ${user.email}. Sign in again through the configured Taxi Ai account page.`);
    console.log('Driver approval here enables testing only; identity and vehicle verification are not implemented.');
  } catch (error) {
    console.error(error instanceof ApplicationError ? error.message : 'Unable to open or update the local database. Check its path and permissions.');
    process.exitCode = 1;
  } finally { db?.close(); }
}
