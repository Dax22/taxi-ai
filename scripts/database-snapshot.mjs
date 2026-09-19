import { saveSnapshot } from '../services/api/src/infrastructure/database-snapshot.mjs';
import { DEFAULT_DATABASE } from '../services/api/src/infrastructure/database.mjs';

const [action, ...args] = process.argv.slice(2);
if (!(['backup', 'restore'].includes(action)) || args.length !== (action === 'backup' ? 1 : 2)) {
  console.error('Usage: npm run backup -- /absolute/new-backup.sqlite');
  console.error('   or: npm run restore -- /absolute/backup.sqlite /absolute/new-restored.sqlite');
  process.exitCode = 1;
} else {
  try {
    const result = action === 'backup'
      ? saveSnapshot(process.env.TAXI_AI_DB ?? DEFAULT_DATABASE, args[0]) : saveSnapshot(args[0], args[1]);
    console.log(`Validated ${action} saved to ${result.destination} (schema ${result.schema}).`);
    console.log('Sessions, live call setup, GPS and unused quotes are cleared in this copy. Source data is unchanged.');
    if (action === 'restore') console.log('Stop the app, point TAXI_AI_DB at this new file and restart. Users must sign in again; review any active test trips.');
  } catch {
    console.error('Snapshot failed. Check source schema/integrity, permissions, free space and that the destination and sidecars do not exist. No existing destination is overwritten.');
    process.exitCode = 1;
  }
}
