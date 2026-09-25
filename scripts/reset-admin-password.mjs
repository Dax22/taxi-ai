import { emitKeypressEvents } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../services/api/src/infrastructure/database.mjs';
import { openPostgresDatabase } from '../services/api/src/infrastructure/postgres.mjs';
import { createApplication } from '../services/api/src/application.mjs';
import { ApplicationError } from '../services/api/src/shared/errors.mjs';
import { emailAddress, passwordInput } from '../services/api/src/shared/validation.mjs';
import { createRuntimeConfig } from '../services/api/src/infrastructure/runtime-config.mjs';
import { createCallConfig } from '../services/api/src/infrastructure/call-config.mjs';
import { createMapProvider } from '../services/api/src/infrastructure/map-provider.mjs';
import { createStaffMfaConfig } from '../services/api/src/infrastructure/staff-config.mjs';

class Cancelled extends Error {}

/** Read only from an interactive terminal; neither input nor masking characters are echoed. */
export function readHiddenPassword(prompt, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new ApplicationError('TERMINAL_REQUIRED',
      'Run this command in the VS Code integrated terminal. Passwords cannot be supplied through arguments, pipes or files.'));
  }
  return new Promise((resolve, reject) => {
    const previousRaw = Boolean(input.isRaw);
    let value = '', finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      input.removeListener('keypress', onKey);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
      input.setRawMode(previousRaw);
      input.pause();
      output.write('\n');
      const result = value;
      value = '';
      if (error) reject(error); else resolve(result);
    };
    const onEnd = () => finish(new Cancelled());
    const onError = () => finish(new Error('Terminal input failed.'));
    const onKey = (text, key = {}) => {
      if (key.ctrl && ['c', 'd'].includes(key.name)) return finish(new Cancelled());
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace' || (key.ctrl && key.name === 'h')) {
        value = [...value].slice(0, -1).join('');
        return;
      }
      if (key.ctrl && key.name === 'u') { value = ''; return; }
      if (key.ctrl || key.meta || !text || /[\u0000-\u001f\u007f]/u.test(text)) return;
      value += text;
      if (value.length > 128) finish(new ApplicationError('INVALID_PASSWORD', 'Use a password containing 12–128 characters.'));
    };
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.on('keypress', onKey);
    input.once('end', onEnd);
    input.once('error', onError);
    output.write(prompt);
    input.resume();
  });
}

async function main() {
  if (process.argv.length !== 3) {
    console.error('Usage: npm run admin:reset-password -- your-admin-email@example.com');
    console.error('Enter the new password only at the hidden terminal prompts.');
    process.exitCode = 1;
    return;
  }
  let db, password = '', confirmation = '';
  try {
    const email = emailAddress(process.argv[2]);
    password = passwordInput(await readHiddenPassword('New password (12–128 characters; hidden): '));
    confirmation = await readHiddenPassword('Confirm new password (hidden): ');
    if (password !== confirmation) {
      throw new ApplicationError('PASSWORD_MISMATCH', 'Passwords did not match. No password was changed; run the command again.');
    }
    confirmation = '';
    const runtime = createRuntimeConfig();
    // This operator task does not make provider calls or decrypt/change enrolled MFA factors.
    const options = { callConfig: createCallConfig({ TAXI_AI_CALLS_MODE: 'off' }),
      mapProvider: createMapProvider({ env: { TAXI_AI_MAPS_MODE: 'off' } }), staffMfa: createStaffMfaConfig({}) };
    db = process.env.TAXI_AI_DATABASE_URL ? await openPostgresDatabase() : openDatabase(runtime.database);
    const user = await createApplication({ db, ...options }).accounts.resetAdminPasswordLocally(email, password);
    console.log(`Password reset for ${user.email}. Sign in at /admin with your new password.`);
    console.log('Existing browser and mobile sessions were signed out. Staff access and enrolled authenticator verification are unchanged.');
  } catch (error) {
    if (error instanceof Cancelled) console.error('Cancelled. No password was changed.');
    else console.error(error instanceof ApplicationError ? error.message
      : 'Unable to reset the administrator password. Check the server database configuration and permissions.');
    process.exitCode = error instanceof Cancelled ? 130 : 1;
  } finally {
    password = ''; confirmation = '';
    try { await db?.close(); }
    catch { console.error('Unable to close the database cleanly.'); process.exitCode = 1; }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
