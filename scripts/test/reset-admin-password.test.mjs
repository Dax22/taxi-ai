import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readHiddenPassword } from '../reset-admin-password.mjs';

const script = fileURLToPath(new URL('../reset-admin-password.mjs', import.meta.url));
function terminal() {
  const input = new PassThrough(), writes = [];
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = value => { input.isRaw = value; };
  return { input, writes, output: { isTTY: true, write: value => { writes.push(value); } } };
}

test('hidden password accepts editing without echo and restores terminal state', async () => {
  const io = terminal(), result = readHiddenPassword('Password: ', io);
  assert.equal(io.input.isRaw, true);
  io.input.write('long-private-passwordx\u007f\r');
  assert.equal(await result, 'long-private-password');
  assert.deepEqual(io.writes, ['Password: ', '\n']);
  assert.equal(io.input.isRaw, false);
  assert.equal(io.input.listenerCount('keypress'), 0);
  io.input.destroy();
});

test('hidden password clears input and preserves an already raw terminal', async () => {
  const io = terminal(); io.input.isRaw = true;
  const result = readHiddenPassword('Password: ', io);
  io.input.write('discard-me\u0015replaced-passphrase\r');
  assert.equal(await result, 'replaced-passphrase');
  assert.equal(io.input.isRaw, true);
  assert.deepEqual(io.writes, ['Password: ', '\n']);
  io.input.destroy();
});

test('Ctrl+C cancels without echo, leaving no active password listener', async () => {
  const io = terminal(), result = readHiddenPassword('Password: ', io);
  io.input.write('do-not-leak-this\u0003');
  await assert.rejects(result);
  assert.equal(io.input.isRaw, false);
  assert.equal(io.input.listenerCount('keypress'), 0);
  assert.deepEqual(io.writes, ['Password: ', '\n']);
  io.input.destroy();
});

test('oversized password fails without displaying its contents', async () => {
  const io = terminal(), result = readHiddenPassword('Password: ', io);
  io.input.write('p'.repeat(129));
  await assert.rejects(result, { code: 'INVALID_PASSWORD' });
  assert.deepEqual(io.writes, ['Password: ', '\n']);
  assert.equal(io.input.isRaw, false);
  io.input.destroy();
});

test('operator command rejects piped passwords and extra arguments before creating a database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taxi-admin-reset-'));
  const database = join(dir, 'must-not-create.sqlite');
  try {
    const env = { ...process.env, TAXI_AI_DB: database, TAXI_AI_DATABASE_URL: '', TAXI_AI_MODE: 'local' };
    const piped = spawnSync(process.execPath, ['--experimental-sqlite', script, 'taxi-admin@example.test'],
      { env, input: 'never-display-this-password\n', encoding: 'utf8' });
    assert.equal(piped.status, 1);
    assert.match(piped.stderr, /VS Code integrated terminal/);
    assert.doesNotMatch(piped.stdout + piped.stderr, /never-display-this-password/);
    const extra = spawnSync(process.execPath, ['--experimental-sqlite', script, 'taxi-admin@example.test', 'never-display-this-password'],
      { env, encoding: 'utf8' });
    assert.equal(extra.status, 1);
    assert.match(extra.stderr, /Usage: npm run admin:reset-password/);
    assert.doesNotMatch(extra.stdout + extra.stderr, /never-display-this-password/);
    assert.equal(existsSync(database), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
