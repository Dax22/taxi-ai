import test from 'node:test';
import assert from 'node:assert/strict';
import { describeConfiguration, collectCounts } from '../runtime-readiness.mjs';
import { openDatabase } from '../../services/api/src/infrastructure/database.mjs';

test('runtime report allowlists settings and never exports credentials, URLs or arbitrary environment values', () => {
  const report = describeConfiguration({ TAXI_AI_CALLS_MODE: 'off', TAXI_AI_ACCESS_MODE: 'public',
    TAXI_AI_RIDES_PAUSED: 'true', TAXI_AI_MAPS_MODE: 'community', TAXI_AI_TURN_SECRET: 'SECRET_VALUE',
    TAXI_AI_TURN_URLS: 'turn:private.example.test', TAXI_AI_DATABASE_URL: 'postgres://secret',
    TAXI_AI_SMTP_PASSWORD: 'SECRET_VALUE', OTHER: 'SECRET_VALUE' });
  assert.equal(report.calls, 'off'); assert.equal(report.turnSecretPresent, true);
  assert.equal(report.passengerRidesPaused, true);
  assert.ok(!JSON.stringify(report).includes('SECRET_VALUE'));
  assert.ok(!JSON.stringify(report).includes('private.example.test'));
  assert.equal(describeConfiguration({ TAXI_AI_CALLS_MODE: 'SECRET_VALUE' }).calls, 'unavailable');
  assert.equal(describeConfiguration({}).passengerRidesPaused, null);
});

test('runtime counter queries operate on the existing schema in a read-only transaction without seeding any driver', async () => {
  const db = openDatabase(':memory:');
  try {
    db.exec('PRAGMA query_only=ON; BEGIN;');
    const counts = await collectCounts(async sql => db.prepare(sql).all(), 1_000_000);
    assert.deepEqual(counts, { registeredDriverProfiles: 0, approvedDriverProfiles: 0,
      submittedDriverApplications: 0, freshGpsAvailabilityLeases: 0, waitingRideRequests: 0 });
    assert.throws(() => db.exec("INSERT INTO users(id,name,email,password_hash,role,created_at) VALUES('x','x','x','x','customer',1)"));
    db.exec('ROLLBACK;');
  } finally { db.close(); }
});

test('missing or invalid counters are unavailable, never silently reported as zero', async () => {
  await assert.rejects(() => collectCounts(async () => []), /INVALID_COUNT/);
  await assert.rejects(() => collectCounts(async () => [{ n: -1 }]), /INVALID_COUNT/);
  await assert.rejects(() => collectCounts(async () => { throw new Error('no permission'); }), /no permission/);
});
