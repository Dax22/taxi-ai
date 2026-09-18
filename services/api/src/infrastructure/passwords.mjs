import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { check } from '../shared/errors.mjs';

const scrypt = promisify(scryptCallback);
const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const DUMMY_HASH = `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`;
let passwordJobs = 0;

async function derive(password, salt) {
  check(passwordJobs < 2, 'AUTH_BUSY', 'Please wait a moment before trying again.');
  passwordJobs++;
  try { return await scrypt(password, salt, 64, SCRYPT); }
  finally { passwordJobs--; }
}

export const passwords = Object.freeze({
  async hash(password) {
    const salt = randomBytes(16).toString('hex');
    const hash = await derive(password, salt);
    return `scrypt$${salt}$${hash.toString('hex')}`;
  },
  async verify(password, stored = DUMMY_HASH) {
    const [algorithm, salt, expected] = stored.split('$');
    if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(expected)) {
      throw new Error('Invalid password record');
    }
    const actual = await derive(password, salt);
    return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
  },
});
