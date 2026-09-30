import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { floorIntegerSql } from '../src/shared/sql-floor.mjs';

test('coordinate bucket SQL works without SQLite optional math functions', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const query = db.prepare(`SELECT ${floorIntegerSql('value')} AS cell FROM (SELECT ? AS value)`);
    for (const value of [-1.9, -1.1, -0.1, 0, 0.1, 1.1, 1.9, 181.6, 746.23]) assert.equal(query.get(value).cell, Math.floor(value));
    assert.equal(query.get(null).cell, null);
  } finally { db.close(); }
});
