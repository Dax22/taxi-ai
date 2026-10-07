import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runtimeReadiness, adminReadiness } from '../admin-readiness-inventory.mjs';

function fixture(staff = false) {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE users(id TEXT,role TEXT);INSERT INTO users VALUES ('owner','admin'),('revoked','admin'),('customer','customer');");
  if (staff) db.exec("CREATE TABLE staff_memberships(user_id TEXT,role TEXT,status TEXT);CREATE TABLE staff_mfa(user_id TEXT);INSERT INTO staff_memberships VALUES ('owner','owner','active'),('revoked','owner','revoked'),('customer','support','active');INSERT INTO staff_mfa VALUES ('owner');");
  db.exec('PRAGMA query_only=ON');
  return { db, query: async sql => db.prepare(sql).all() };
}

test('configuration audit outputs missing setting names but no credentials', () => {
  const result = runtimeReadiness({ TAXI_AI_EMAIL_MODE: 'smtp', TAXI_AI_SMTP_USER: 'private-mailbox@invalid.test',
    TAXI_AI_SMTP_PASSWORD: 'private-password-never-return', TAXI_AI_CONTACT_SMTP_USER: 'contact-private@invalid.test',
    TAXI_AI_STAFF_MFA_KEY: 'a'.repeat(64), TAXI_AI_STAFF_MFA_REQUIRED: 'true', TAXI_AI_SEARCH_URL: 'https://private-provider.invalid/path' });
  for (const value of ['private-mailbox', 'private-password-never-return', 'contact-private', 'private-provider', 'a'.repeat(64)]) assert.equal(JSON.stringify(result).includes(value), false);
  assert.equal(result.staffMfa.required, true); assert.equal(result.staffMfa.keyFormatValid, true);
  assert.deepEqual(result.accountEmail.missingKeys, ['TAXI_AI_SMTP_HOST', 'TAXI_AI_SMTP_PORT', 'TAXI_AI_SMTP_FROM']);
});

test('presence is never reported as successful authentication or provider capacity', () => {
  const result = runtimeReadiness({ TAXI_AI_MAPS_MODE: 'dedicated', TAXI_AI_EMAIL_MODE: 'smtp' });
  assert.equal(result.maps.capacityVerified, false); assert.equal(result.accountEmail.authenticationVerified, false);
  assert.equal(result.contactEmail.inboxDeliveryVerified, false);
  assert.equal(runtimeReadiness({ TAXI_AI_STAFF_MFA_REQUIRED: 'yes' }).staffMfa.policyValid, false);
});

test('unknown or missing staff tables are not mistaken for zero owners', async () => {
  const f = fixture();
  try {
    const result = await adminReadiness(f.query, 'sqlite');
    assert.equal(result.administratorAccounts, 2); assert.equal(result.activeOwners, null);
    assert.equal(result.activeOwnersWithMfa, null); assert.equal(result.membershipTablePresent, false);
  } finally { f.db.close(); }
});

test('read-only SQLite counts only active admin owners and enrolled factors', async () => {
  const f = fixture(true);
  try {
    const result = await adminReadiness(f.query, 'sqlite');
    assert.equal(result.activeOwners, 1); assert.equal(result.activeOwnersWithMfa, 1);
    assert.equal(result.successfulLoginVerified, false);
    assert.equal(Object.hasOwn(result, 'email'), false);
  } finally { f.db.close(); }
});

test('PostgreSQL catalog branch returns aggregates without reading credential columns', async () => {
  const queries = [];
  const result = await adminReadiness(async sql => {
    queries.push(sql);
    return sql.includes('information_schema.tables') ? [{ name: 'staff_memberships' }, { name: 'staff_mfa' }] : [{ n: '2' }];
  }, 'postgres');
  assert.equal(result.activeOwners, 2); assert.equal(result.activeOwnersWithMfa, 2);
  for (const sql of queries) { assert.match(sql, /^SELECT /); assert.doesNotMatch(sql, /secret_encrypted|password_hash|SELECT \*/); }
});

test('invalid aggregate counts and unknown storage fail rather than inventing results', async () => {
  await assert.rejects(adminReadiness(async sql => sql.includes('sqlite_master') ? [] : [{ n: 'not-a-number' }], 'sqlite'));
  await assert.rejects(adminReadiness(async () => [], 'unknown'));
});
