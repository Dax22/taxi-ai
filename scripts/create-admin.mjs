import { openDatabase } from '../services/api/src/database.mjs';
import { bootstrapAdmin } from '../services/api/src/rides.mjs';

if (process.argv.length !== 3) {
  console.error('Usage: npm run admin -- your-admin-email@example.com');
  console.error('Register a separate customer account at /app first. This command grants it the first administrator role.');
  process.exitCode = 1;
} else {
  let db;
  try {
    db = openDatabase();
    const user = bootstrapAdmin(db, process.argv[2]);
    console.log(`Administrator enabled for ${user.email}. Sign in again at http://localhost:${process.env.PORT ?? 3000}/app.`);
    console.log('Driver approval here enables local testing only; identity and vehicle verification are not implemented.');
  } catch (error) {
    console.error(error.status ? error.message : 'Unable to open or update the local database. Check its path and permissions.');
    process.exitCode = 1;
  } finally { db?.close(); }
}
