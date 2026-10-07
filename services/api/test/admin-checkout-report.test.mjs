import test from 'node:test';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { asAsyncDatabase } from '../src/infrastructure/async-database.mjs';
import { verifyCombinedReport } from './admin-report-fixtures.mjs';

test('combined kitchen reporting follows checkout membership and counts allocated amounts once',async()=>{
  const raw=openDatabase(':memory:');
  try { await verifyCombinedReport(asAsyncDatabase(raw)); }
  finally { raw.close(); }
});
