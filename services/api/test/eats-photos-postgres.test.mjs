import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPostgresDatabase, migratePostgres } from '../src/infrastructure/postgres.mjs';
import { createEatsRepository } from '../src/modules/eats/repository.mjs';

const connectionString = process.env.TAXI_AI_TEST_POSTGRES_URL;
test('PostgreSQL photo migration consolidates legacy bytes and preserves scoped moderation, assets and pagination', { skip: !connectionString }, async () => {
  const schema = `test_eats_photos_${randomUUID().replaceAll('-', '')}`;
  const db = await openPostgresDatabase({ connectionString, schema, max: 2, migrate: true });
  try {
    const owner = randomUUID(), reviewer = randomUUID(), storeId = randomUUID(), itemId = randomUUID(), existingId = randomUUID(), fallbackItem = randomUUID(), now = Date.now();
    for (const id of [owner, reviewer]) await db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(id, `${id}@example.test`, 'Photo fixture', 'unused', 'customer', now);
    const repository = createEatsRepository(db, { deliveryAreas: () => [], legacyAreaIds: [], distanceMeters: () => 0 });
    await repository.createStore({ id: storeId, details: { name: 'PG photo kitchen' } }, owner, now);
    await repository.saveMenu(itemId, storeId, { name: 'Jollof', available: true, photoId: existingId });
    await repository.saveMenu(fallbackItem, storeId, { name: 'Soup', available: true, photoId: null });
    const bytes = Buffer.from('preserved original photo bytes');
    // Reconstruct the immediately previous schema with both canonical and item-only legacy photos.
    await db.exec(`DROP TABLE eats_photo_reviews; DROP TABLE eats_store_assets; DROP INDEX eats_photo_review_queue;
      ALTER TABLE eats_photos DROP COLUMN purpose, DROP COLUMN status, DROP COLUMN version, DROP COLUMN review_note, DROP COLUMN size_bytes;
      DELETE FROM taxi_schema_migrations WHERE version=15;`);
    await db.prepare('INSERT INTO eats_photos(id,store_id,base64,created_at) VALUES(?,?,?,?)').run(existingId, storeId, bytes.toString('base64'), now);
    for (const id of [itemId, fallbackItem]) await db.prepare('INSERT INTO eats_menu_photos(item_id,store_id,content,size_bytes,version) VALUES(?,?,?,?,?)').run(id, storeId, bytes, bytes.length, 8);
    await migratePostgres(db);
    assert.equal((await repository.photo(existingId)).status, 'legacy-approved');
    const fallbackId = (await repository.menuItem(fallbackItem)).photoId, migrated = await repository.photo(fallbackId);
    assert.equal(migrated.base64, bytes.toString('base64')); assert.equal(migrated.version, 8); assert.equal(migrated.sizeBytes, bytes.length);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM eats_menu_photos').get()).n, 0);
    assert.equal((await repository.store(storeId)).coverPhotoId !== null, true);
    const logoId = randomUUID(), referenceId = randomUUID();
    await db.transaction(async () => {
      await repository.savePhoto(logoId, storeId, bytes.toString('base64'), now + 1, 'logo'); await repository.saveAsset(storeId, 'logo', logoId);
      await repository.savePhoto(referenceId, storeId, bytes.toString('base64'), now + 2, 'menu_reference'); await repository.saveAsset(storeId, 'menu_reference', referenceId);
    });
    const queue = await repository.photoQueue('pending'); assert.deepEqual(queue.map(p => p.id), [logoId]); assert.equal(queue[0].storeName, 'PG photo kitchen');
    assert.equal((await repository.assets(storeId)).find(p => p.id === referenceId).status, 'private');
    assert.ok(await repository.attachedPhoto(logoId));
    await db.transaction(async () => repository.reviewPhoto(await repository.photo(logoId), reviewer, 'rejected', 'Wrong restaurant logo, replace it.', now + 3));
    assert.equal((await repository.photoQueue('rejected'))[0].version, 2);
    await db.transaction(async () => { await repository.saveAsset(storeId, 'logo', null); await repository.prunePhotos(storeId); });
    assert.equal(await repository.photo(logoId), null);
    assert.equal((await db.prepare('SELECT count(*) AS n FROM eats_photo_reviews WHERE photo_id=?').get(logoId)).n, 1);
    assert.equal(await repository.photoBytes(storeId), bytes.length * 3);
    const historical = await repository.photoQueue('legacy-approved'); assert.equal(historical.length, 2);
    assert.equal((await repository.photoQueue('legacy-approved', historical[0])).length, 1);
  } finally { await db.exec(`DROP SCHEMA "${schema}" CASCADE`); await db.close(); }
});
