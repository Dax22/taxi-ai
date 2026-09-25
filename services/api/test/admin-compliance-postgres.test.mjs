import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPostgresDatabase } from '../src/infrastructure/postgres.mjs';
import { tokens } from '../src/infrastructure/tokens.mjs';
import { createAudit } from '../src/infrastructure/audit.mjs';
import { createAdminComplianceRepository } from '../src/modules/admin-compliance/repository.mjs';
import { createAdminComplianceService } from '../src/modules/admin-compliance/service.mjs';
import { createDriversRepository } from '../src/modules/drivers/repository.mjs';
import { eligibility } from '../src/modules/drivers/domain.mjs';

const connectionString = process.env.TAXI_AI_TEST_POSTGRES_URL;
test('PostgreSQL compliance queues and internal follow-up commands preserve WAT expiry and audit semantics', {
  skip: !connectionString && 'Set TAXI_AI_TEST_POSTGRES_URL to an isolated PostgreSQL/PostGIS test database.', timeout: 120000,
}, async () => {
  const schema = `test_compliance_${randomUUID().replaceAll('-', '')}`;
  const db = await openPostgresDatabase({ connectionString, schema, max: 1, migrate: true });
  try {
    let now = Date.parse('2026-09-25T22:59:59.999Z');
    const driverId = randomUUID(), staffId = randomUUID();
    for (const id of [driverId, staffId]) await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES (?,?,?,'test','customer',?)")
      .run(id, `${id}@example.test`, id === driverId ? 'Compliance test driver' : 'Staff', now);
    await db.prepare("INSERT INTO drivers(user_id,status,vehicle_model,vehicle_plate) VALUES (?,'approved','Test car','CT-123')").run(driverId);
    await db.prepare("INSERT INTO driver_applications(driver_id,status,details_json,verification_json,reviewed_at,review_reason,updated_at) VALUES (?,'approved','{}',?,?,?,?)")
      .run(driverId, JSON.stringify({ method: 'manual', reference: 'Approved manual reference', private: 'SECRET' }), now, 'Review completed.', now);
    await db.prepare("INSERT INTO account_capabilities(user_id,capability,created_at) VALUES (?,'driver',?)").run(driverId, now);
    for (const kind of ['profile_photo', 'driving_licence', 'vehicle_registration', 'insurance', 'vehicle_photo']) {
      await db.prepare("INSERT INTO driver_documents(id,driver_id,kind,name,mime_type,size_bytes,sha256,expires_on,content,created_at) VALUES (?,?,?,'SECRET','image/png',1,'SECRET',?,?,?)")
        .run(randomUUID(), driverId, kind, kind.endsWith('photo') ? null : '2026-09-25', Buffer.from([0]), now);
    }
    const driverRepository = createDriversRepository(db);
    const service = createAdminComplianceService({ repository: createAdminComplianceRepository(db), tokens,
      audit: createAudit(db), clock: () => now, unitOfWork: (run) => db.transaction(run), requirePermission: async () => {},
      getEligibility: async (id) => eligibility(await driverRepository.application(id), await driverRepository.documents(id), now) });
    let result = await service.list(staffId, { queue: 'expiring', q: 'compliance', followUp: 'all', limit: '1' });
    assert.equal(result.summary.eligible, 1); assert.equal(result.summary.expiring, 1); assert.equal(result.drivers[0].id, driverId);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
    const key = randomUUID(), data = { expectedVersion: 0, dueAt: now + 60_000, note: 'Review upcoming document expiry.' };
    result = await service.command({ userId: staffId, id: driverId, action: 'follow-up', key, data });
    assert.equal(result.driver.followUp.version, 1); assert.equal(result.review.reference, 'Approved manual reference');
    assert.equal(result.events.length, 1); assert.ok(!JSON.stringify(result).includes('SECRET'));
    assert.equal((await service.command({ userId: staffId, id: driverId, action: 'follow-up', key, data })).replayed, true);
    now++;
    result = await service.list(staffId, { queue: 'expired', followUp: 'open', q: 'CT-' });
    assert.equal(result.summary.expired, 1); assert.equal(result.summary.eligible, 0); assert.equal(result.drivers[0].eligibility.eligible, false);
    result = await service.command({ userId: staffId, id: driverId, action: 'complete', key: randomUUID(), data: { expectedVersion: 1, note: 'Expiry reviewed and follow-up completed.' } });
    assert.equal(result.driver.followUp.status, 'done'); assert.equal(result.driver.applicationStatus, 'approved');
    result = await service.get(staffId, driverId, { limit: '1' });
    assert.ok(result.page.next);
    const page = await service.get(staffId, driverId, { limit: '1', before: result.page.next });
    assert.equal(page.events.length, 1); assert.notEqual(page.events[0].id, result.events[0].id);
  } finally { await db.exec(`DROP SCHEMA "${schema}" CASCADE`); await db.close(); }
});
