import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseTesterAccess } from '../services/api/src/infrastructure/runtime-config.mjs';

const [action, name, inputFile, ...extra] = process.argv.slice(2);
let lock, temporary, file;
try {
  if (!['add', 'remove'].includes(action) || !/^[a-z0-9_-]{3,40}$/.test(name ?? '') || !inputFile || extra.length) {
    throw new Error('Usage: npm run staging:access -- add|remove tester-name ./secrets/staging-testers.json');
  }
  file = resolve(inputFile); mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  lock = openSync(file + '.lock', 'wx', 0o600);
  let value = { version: 1, testers: [] };
  if (existsSync(file)) {
    if (!lstatSync(file).isFile() || lstatSync(file).size > 16384) throw new Error('Use a regular tester access file.');
    value = JSON.parse(readFileSync(file, 'utf8'));
    if (!(value.version === 1 && Array.isArray(value.testers) && value.testers.length === 0)) parseTesterAccess(value);
  }
  const existing = value.testers.find((row) => row.name === name);
  let token;
  if (action === 'add') {
    if (existing || value.testers.length >= 50) throw new Error('Tester already exists or the 50-tester preview limit was reached.');
    token = randomBytes(32).toString('hex');
    value.testers.push({ name, tokenHash: createHash('sha256').update(token).digest('hex') });
  } else {
    if (!existing) throw new Error('Tester was not found.');
    value.testers = value.testers.filter((row) => row.name !== name);
  }
  const next = file + '.' + randomBytes(8).toString('hex') + '.new';
  const descriptor = openSync(next, 'wx', 0o600); temporary = next;
  try { writeFileSync(descriptor, JSON.stringify(value, null, 2) + '\n'); } finally { closeSync(descriptor); }
  renameSync(temporary, file); temporary = null;
  if (token) console.log(`Tester username: ${name}\nTester access key (shown once): ${token}`);
  else console.log('Tester removed. Removing the last tester makes staging startup fail closed.');
  console.log('Restart/recreate the app to load access changes. This key is separate from the Taxi Ai account password.');
} catch (error) {
  console.error(error.code || error instanceof SyntaxError ? 'Unable to update tester access. Check the file, permissions and any concurrent command.' : error.message);
  process.exitCode = 1;
} finally {
  if (temporary) rmSync(temporary, { force: true });
  if (lock !== undefined) { closeSync(lock); rmSync(file + '.lock', { force: true }); }
}
