import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPostgresDatabase } from '../src/infrastructure/postgres.mjs';
import { tokens } from '../src/infrastructure/tokens.mjs';
import { createBackgroundLocationRepository } from '../src/modules/background-locations/repository.mjs';
import { createBackgroundLocationService } from '../src/modules/background-locations/service.mjs';

const connectionString = process.env.TAXI_AI_TEST_POSTGRES_URL;
test('PostgreSQL concurrent background grants and rotations leave one usable scoped credential without altering account tokens',
  { skip: !connectionString, timeout: 60000 }, async () => {
    const schema = `test_background_${randomUUID().replaceAll('-', '')}`;
    const first = await openPostgresDatabase({ connectionString, schema, max: 1, migrate: true });
    let second;
    try {
      second = await openPostgresDatabase({ connectionString, schema, max: 1 });
      const driverId = randomUUID(), sessionId = randomUUID(), now = Date.now();
      const accessToken = tokens.generate(), refreshToken = tokens.generate();
      await first.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)')
        .run(driverId, `${driverId}@example.test`, 'Synthetic background driver', 'unused-test-hash', 'driver', now);
      await first.prepare(`INSERT INTO device_sessions(id,user_id,name,access_hash,access_expires_at,created_at,refreshed_at,expires_at,idle_expires_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(sessionId, driverId, 'Synthetic phone', tokens.digest(accessToken), now + 600_000,
        now, now, now + 30 * 86400_000, now + 7 * 86400_000);
      await first.prepare('INSERT INTO device_refresh_tokens(token_hash,session_id) VALUES(?,?)').run(tokens.digest(refreshToken), sessionId);
      const accountBefore = await first.prepare('SELECT * FROM device_sessions WHERE id=?').get(sessionId);
      const refreshBefore = await first.prepare('SELECT * FROM device_refresh_tokens WHERE session_id=?').all(sessionId);
      const issued = [];

      for (const [round, kind] of ['ride', 'food'].entries()) {
        const data = Object.freeze({ kind, jobId: randomUUID(), shareId: randomUUID(), clientId: randomUUID() });
        const input = Object.freeze({ userId: driverId, nativeSessionId: sessionId });
        let entered = 0, release;
        const ready = new Promise(resolve => { release = resolve; }), backendIds = new Set();
        const service = db => createBackgroundLocationService({
          repository: createBackgroundLocationRepository(db), unitOfWork: work => db.transaction(work), tokens,
          clock: () => now + round * 1000,
          nativeSessionOwner: async id => id === sessionId ? driverId : null,
          trackerFor: requestedKind => {
            assert.equal(requestedKind, kind);
            return {
              async tracking(ctx, jobId) {
                assert.deepEqual(ctx, { ...input, clientId: data.clientId }); assert.equal(jobId, data.jobId);
                // Establish both SERIALIZABLE snapshots before either insert.
                // The barrier stays open for the adapter's full-transaction retry.
                const row = await db.prepare('SELECT id,pg_backend_pid() AS pid FROM users WHERE id=?').get(driverId);
                assert.equal(row.id, driverId); backendIds.add(row.pid);
                if (++entered === 2) release();
                await ready;
                return { isDriver: true, canShare: true, share: { id: data.shareId, active: true, owned: true, sequence: 4 } };
              },
              async freshPositionFor(owner, jobId) {
                assert.equal(owner, driverId); assert.equal(jobId, data.jobId);
                return { lat: 9.08, lng: 7.4, accuracy: 10, capturedAt: now + round * 1000 };
              },
            };
          },
        });
        const a = service(first), b = service(second);
        const results = await Promise.allSettled([a.issue(input, data), b.issue(input, data)]);
        assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled'],
          JSON.stringify(results.map(result => result.reason && { code: result.reason.code, message: result.reason.message })));
        assert.equal(backendIds.size, 2, 'The requests must use independent PostgreSQL connections');
        const grants = results.map(result => {
          assert.deepEqual(Object.keys(result.value), ['background']); return result.value.background;
        });
        assert.notEqual(grants[0].token, grants[1].token);
        const rows = await first.prepare('SELECT * FROM background_location_tokens').all();
        assert.equal(rows.length, 1);
        const row = rows[0], winner = grants.find(grant => tokens.digest(grant.token) === row.token_hash);
        assert.ok(winner, 'The stored credential must belong to a committed response');
        assert.equal(row.kind, kind); assert.equal(row.job_id, data.jobId); assert.equal(row.share_id, data.shareId);
        assert.equal(row.client_id, data.clientId); assert.equal(row.driver_id, driverId); assert.equal(row.session_id, sessionId);
        assert.equal(row.expires_at, now + round * 1000 + 12 * 60 * 60_000);
        issued.push(...grants.map(grant => grant.token));
        for (const token of issued) {
          if (token === winner.token) assert.equal(await b.owner(token), driverId);
          else await assert.rejects(a.owner(token), { code: 'UNAUTHENTICATED' });
          assert.equal(JSON.stringify(rows).includes(token), false, 'Only token hashes belong in storage');
        }
        assert.equal(JSON.stringify(grants).includes(accessToken), false); assert.equal(JSON.stringify(grants).includes(refreshToken), false);
        await assert.rejects(a.owner(accessToken), { code: 'UNAUTHENTICATED' });
        await assert.rejects(b.owner(refreshToken), { code: 'UNAUTHENTICATED' });
      }
      assert.deepEqual(await first.prepare('SELECT * FROM device_sessions WHERE id=?').get(sessionId), accountBefore);
      assert.deepEqual(await first.prepare('SELECT * FROM device_refresh_tokens WHERE session_id=?').all(sessionId), refreshBefore);
    } finally {
      if (second) await second.close();
      await first.exec(`DROP SCHEMA "${schema}" CASCADE`); await first.close();
    }
  });
