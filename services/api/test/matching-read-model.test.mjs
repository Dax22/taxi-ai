import test from 'node:test';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
import { matchingParity } from './matching-read-model-fixtures.mjs';

test('batched matching projection preserves SQLite eligibility and bounded reads', async t => {
  const db = asAsyncDatabase(openDatabase(':memory:'));
  try { await matchingParity(t, db); } finally { await db.close(); }
});
