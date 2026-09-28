import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePostgresQuery } from '../src/infrastructure/postgres-sql.mjs';

test('PostgreSQL binding preserves quoted data and camelCase result contracts', () => {
  const value = "O'Neil ? $now";
  const result = compilePostgresQuery("SELECT user_id AS userId, '?' AS literal FROM users WHERE name=? AND (? IS NULL OR id=?)", [value, null, null]);
  assert.equal(result.text, 'SELECT user_id AS "userId", \'?\' AS literal FROM users WHERE name=$1 AND ($2::text IS NULL OR id=$3)');
  assert.deepEqual(result.values, [value, null, null]);
  const named = compilePostgresQuery('WITH trips AS (SELECT created_at AS createdAt FROM rides WHERE created_at>$now) SELECT createdAt FROM trips WHERE createdAt>$now', [{ now: 123 }]);
  assert.deepEqual(named.values, [123]);
  assert.match(named.text, /SELECT "createdAt" FROM trips WHERE "createdAt">\$1/);
});

test('PostgreSQL adaptation covers SQLite JSON scalars, aggregates and conflict identities', () => {
  const result = compilePostgresQuery("SELECT json_extract(details_json,'$.pickupEnabled') AS pickupEnabled,json_extract(payload,'$.amountKobo') AS amountKobo,SUM(status='completed') AS completed FROM rides");
  assert.match(result.text, /WHEN 'true' THEN 1 WHEN 'false' THEN 0/);
  assert.match(result.text, /::bigint AS "amountKobo"/);
  assert.match(result.text, /SUM\(CASE WHEN status='completed' THEN 1 ELSE 0 END\)/);
  const insert = compilePostgresQuery('INSERT OR IGNORE INTO account_notifications(user_id) VALUES(?)', ['a'], { identity: true });
  assert.equal(insert.text, 'INSERT INTO account_notifications(user_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING id');
  assert.match(compilePostgresQuery('SELECT ST_DWithin(location,ST_SetSRID(ST_MakePoint(?,?),4326)::geography,?)', [7, 9, 1000]).text, /ST_MakePoint\(\$1,\$2\)/);
});

test('PostgreSQL query adapter rejects missing bindings and SQLite administration', () => {
  assert.throws(() => compilePostgresQuery('SELECT ?'), /Missing positional/);
  assert.throws(() => compilePostgresQuery('SELECT $id', [{}]), /Missing named/);
  assert.throws(() => compilePostgresQuery('SELECT 1', [2]), /Too many/);
  assert.throws(() => compilePostgresQuery('PRAGMA user_version'), /SQLite administration/);
});
