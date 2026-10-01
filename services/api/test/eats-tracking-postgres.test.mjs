import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { openPostgresDatabase } from '../src/infrastructure/postgres.mjs';
import { createLocationsService } from '../src/modules/locations/service.mjs';
import { createFoodTrackingRepository } from '../src/modules/locations/repository.mjs';
import { check } from '../src/shared/errors.mjs';

const connectionString = process.env.TAXI_AI_TEST_POSTGRES_URL;
test('PostgreSQL food tracking serializes publisher races and clears GPS on terminal order and session revocation', { skip: !connectionString }, async () => {
  const schema = `test_food_tracking_${randomUUID().replaceAll('-', '')}`;
  const db = await openPostgresDatabase({ connectionString, schema, max: 2, migrate: true });
  let other;
  try {
    let now = Date.now(); const driverId = randomUUID(), customerId = randomUUID(), vendorId = randomUUID(), storeId = randomUUID(), orderId = randomUUID();
    const digest = value => createHash('sha256').update(value).digest('hex'), token = 'food-tracking-test-session';
    for (const id of [driverId, customerId, vendorId]) await db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(id, `${id}@example.test`, 'Food tracking test user', 'unused', 'customer', now);
    await db.prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES(?,?,?,?)').run(digest(token), driverId, 'unused', now + 1000000);
    await db.prepare('INSERT INTO eats_stores(id,status,details_json,created_at,updated_at) VALUES(?,?,?,?,?)').run(storeId, 'approved', '{}', now, now);
    await db.prepare("INSERT INTO eats_memberships(user_id,store_id,role) VALUES(?,?,'owner')").run(vendorId, storeId);
    await db.prepare("INSERT INTO eats_orders(id,store_id,customer_id,courier_id,status,snapshot_json,events_json,created_at,updated_at) VALUES(?,?,?,?,'assigned','{}','[]',?,?)").run(orderId, storeId, customerId, driverId, now, now);
    const getAccount = async id => ({ id, role: 'customer', capabilities: ['customer', ...(id === driverId ? ['driver'] : [])], driver: id === driverId ? { status: 'approved' } : null });
    const service = database => createLocationsService({ repository: createFoodTrackingRepository(database), provider: {}, getAccount,
      sessionOwner: async hash => (await database.prepare('SELECT user_id AS userId FROM sessions WHERE token_hash=? AND expires_at>?').get(hash, now))?.userId,
      getRideContext: async (user, id) => {
        const order = await database.prepare('SELECT customer_id AS customerId,courier_id AS driverId,status FROM eats_orders WHERE id=?').get(id);
        check(order && [order.customerId, order.driverId].includes(user.id), 'NOT_FOUND', 'Delivery not found.'); return order;
      }, canShare: status => ['assigned','picked_up','arrived'].includes(status), resourceLabel: 'delivery', clock: () => now,
      unitOfWork: work => database.transaction(work), tokens: { id: randomUUID, digest }, audit: { record: async () => {} } });
    other = await openPostgresDatabase({ connectionString, schema, max: 2 });
    const first = service(db), second = service(other);
    const input = { userId: driverId, sessionToken: token, clientId: randomUUID() }, input2 = { ...input, clientId: randomUUID() };
    const race = await Promise.allSettled([first.shareCommand(input, 'start', orderId, {}, randomUUID()), second.shareCommand(input2, 'start', orderId, {}, randomUUID())]);
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1); assert.equal(race.find(r => r.status === 'rejected').reason.code, 'LOCATION_BUSY');
    const owner = race[0].status === 'fulfilled' ? input : input2, tracker = race[0].status === 'fulfilled' ? first : second;
    const share = race.find(r => r.status === 'fulfilled').value.share;
    assert.equal((await db.prepare('SELECT count(*) AS n FROM eats_location_shares WHERE active=1').get()).n, 1);
    const vendorRevision = (await db.prepare('SELECT revision FROM account_revisions WHERE user_id=?').get(vendorId))?.revision;
    await tracker.update(owner, share.id, { sequence: 1, lat: 9.08, lng: 7.4, accuracy: 10, capturedAt: now });
    assert.equal((await first.freshPositionFor(driverId, orderId, now)).lat, 9.08);
    assert.equal((await db.prepare('SELECT revision FROM account_revisions WHERE user_id=?').get(vendorId))?.revision, vendorRevision);
    assert.equal(await first.freshPositionFor(customerId, orderId, now), null);
    now += 30000; assert.equal(await second.freshPositionFor(driverId, orderId, now), null);
    await tracker.update(owner, share.id, { sequence: 2, lat: 9.081, lng: 7.4, accuracy: 10, capturedAt: now });
    await db.prepare("UPDATE eats_orders SET status='delivered',updated_at=? WHERE id=?").run(now, orderId);
    const stopped = await createFoodTrackingRepository(other).share(share.id); assert.equal(stopped.active, 0); assert.equal(stopped.positionJson, null); assert.equal(stopped.sessionHash, null);
    await db.prepare("UPDATE eats_orders SET status='assigned',updated_at=? WHERE id=?").run(now, orderId);
    const resumed = await first.shareCommand(input, 'start', orderId, {}, randomUUID());
    await first.update(input, resumed.share.id, { sequence: 1, lat: 9.08, lng: 7.4, accuracy: 10, capturedAt: now });
    await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));
    assert.equal((await createFoodTrackingRepository(other).share(resumed.share.id)).positionJson, null);
    const priorFoodKeys = (await db.query("SELECT conname,condeferrable FROM pg_constraint WHERE connamespace=(SELECT oid FROM pg_namespace WHERE nspname=$1) AND conname IN ('eats_delivery_profiles_user_id_fkey','eats_store_assets_photo_id_fkey','eats_photo_reviews_reviewer_id_fkey')", [schema])).rows;
    assert.equal(priorFoodKeys.length, 3); assert.ok(priorFoodKeys.every(key => key.condeferrable));
  } finally { if (other) await other.close(); await db.exec(`DROP SCHEMA "${schema}" CASCADE`); await db.close(); }
});
