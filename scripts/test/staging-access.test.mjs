import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('tester access generation stores only a hash, refuses duplicate additions and removes access by name', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'taxi-tester-')); t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'testers.json'), script = fileURLToPath(new URL('../staging-access.mjs', import.meta.url));
  const run = (action, name) => spawnSync(process.execPath, ['--experimental-sqlite', script, action, name, path], { encoding: 'utf8' });
  const result = run('add', 'fixture'); assert.equal(result.status, 0, result.stderr);
  const key = result.stdout.match(/shown once\): ([a-f0-9]{64})/)[1];
  const content = readFileSync(path, 'utf8'); assert.ok(!content.includes(key));
  assert.equal(JSON.parse(content).testers[0].tokenHash, createHash('sha256').update(key).digest('hex'));
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.notEqual(run('add', 'fixture').status, 0); assert.equal(readFileSync(path, 'utf8'), content);
  assert.equal(run('remove', 'fixture').status, 0); assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).testers, []);
  assert.equal(run('add', 'next-tester').status, 0);
});
