import test from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { openPostgresDatabase } from '../src/infrastructure/postgres.mjs';
import { createApplication } from '../src/application.mjs';
import { createDispatchRepository } from '../src/modules/dispatch/repository.mjs';
import { readMatchingFastConfig } from '../src/infrastructure/matching-fast-config.mjs';
import { matchingParity, matchingNow as now } from './matching-read-model-fixtures.mjs';

const connectionString = process.env.TAXI_AI_TEST_POSTGRES_URL;
test('native PostgreSQL batched matching projection preserves eligibility and bounded reads', { skip: !connectionString, timeout: 60000 }, async t => {
  const schema = `test_matching_${randomUUID().replaceAll('-', '')}`;
  const db = await openPostgresDatabase({ connectionString, schema, max: 2, migrate: true });
  let other;
  try {
    await matchingParity(t, db);
    other = await openPostgresDatabase({ connectionString, schema, max: 2 });
    await t.test('another connection can revoke approval during routing and the fresh commit refuses its offer', async () => {
      await db.prepare('DELETE FROM dispatch_offers').run();
      const from = { lat: 9.08, lng: 7.4, capturedAt: now }, to = { lat: 9.081, lng: 7.4 };
      await db.prepare("UPDATE driver_availability SET mode='gps',area_id=NULL,position_json=?,latitude=?,longitude=?")
        .run(JSON.stringify(from), from.lat, from.lng);
      await db.prepare("INSERT INTO location_quotes(id,customer_id,created_at,expires_at,route_json,ride_id) VALUES('quote','customer',?,?,?,'ride')")
        .run(now, now + 60_000, JSON.stringify({ pickup: to, destination: { lat: 9.09, lng: 7.4 } }));
      let enter, resume;
      const entered = new Promise(resolve => { enter = resolve; });
      const resumed = new Promise(resolve => { resume = resolve; });
      const app = createApplication({ db, clock: () => now, allowSimulation: true,
        matchingFast: readMatchingFastConfig({ TAXI_AI_MATCHING_FAST_PATH: 'true' }), dispatchConfig: { mode: 'sequential' },
        mapProvider: { mode: 'dedicated', pickupEstimates: async () => { enter(); await resumed; return []; } } });
      const work = app.dispatch.refresh({ region: 'sample:wuse-ii' });
      try {
        await Promise.race([entered, work.then(() => { throw new Error('Matching did not reach routing.'); })]);
        await other.prepare("UPDATE drivers SET status='pending' WHERE user_id='driver'").run();
      } finally { resume(); await work; await app.dispatch.stop(); }
      assert.equal(await createDispatchRepository(other).forDriver('driver'), null);
    });
  } finally {
    await other?.close();
    try { await db.exec(`DROP SCHEMA "${schema}" CASCADE`); } finally { await db.close(); }
  }
});
