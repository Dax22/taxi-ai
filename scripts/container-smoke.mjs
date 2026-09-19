import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// CI-only disposable container: no published ports, real providers or deployment.
const folder = mkdtempSync(join(tmpdir(), 'taxi-container-'));
const name = `taxi-check-${randomUUID()}`, volume = `${name}-data`, image = process.argv[2] ?? 'taxi-ai-staging:test';
const proxy = randomBytes(32).toString('hex'), access = randomBytes(32).toString('hex');
const envFile = join(folder, 'runtime.env'), testers = join(folder, 'testers.json');
const docker = (args, input) => execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 180000 });
let createdVolume = false, createdContainer = false;
writeFileSync(testers, JSON.stringify({ version: 1, testers: [{ name: 'fixture', tokenHash: createHash('sha256').update(access).digest('hex') }] }), { mode: 0o644 });
writeFileSync(envFile, `TAXI_AI_DOMAIN=taxi.example.test\nTAXI_AI_PUBLIC_ORIGIN=https://taxi.example.test\nTAXI_AI_PROXY_TOKEN=${proxy}\nTAXI_AI_TEST_KEY=${access}\nTAXI_AI_STAGING_ACCESS_FILE=/run/secrets/testers\nTAXI_AI_DB=/data/preview.sqlite\nTAXI_AI_CALLS_MODE=off\nTAXI_AI_MAPS_MODE=off\n`, { mode: 0o600 });
const requestScript = `
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
const headers = { Host: 'taxi.example.test', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '192.0.2.1',
  'X-Taxi-Ai-Proxy-Token': process.env.TAXI_AI_PROXY_TOKEN,
  Authorization: 'Basic ' + Buffer.from('fixture:' + process.env.TAXI_AI_TEST_KEY).toString('base64') };
function send(path, method = 'GET', data, extra = {}) { return new Promise((resolve, reject) => {
  const req = request('http://127.0.0.1:3000' + path, { method, headers: { ...headers, ...extra } }, (res) => {
    let body = ''; res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
  }); req.on('error', reject); req.end(data === undefined ? undefined : JSON.stringify(data));
}); }
`;
async function ready() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { docker(['exec', name, 'node', 'scripts/healthcheck.mjs']); return; } catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
  }
  throw new Error('Container did not become ready.');
}
try {
  const caddyfile = fileURLToPath(new URL('../deploy/staging/Caddyfile', import.meta.url));
  docker(['run', '--rm', '--env-file', envFile, '--mount', `type=bind,source=${caddyfile},target=/etc/caddy/Caddyfile,readonly`,
    'caddy:2-alpine', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile']);
  console.log('Caddy gateway configuration validated.');
  docker(['volume', 'create', volume]); createdVolume = true;
  docker(['run', '--detach', '--name', name, '--init', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--env-file', envFile, '--mount', `type=bind,source=${testers},target=/run/secrets/testers,readonly`,
    '--mount', `type=volume,source=${volume},target=/data`, '--tmpfs', '/tmp:size=64m,mode=1777', image]); createdContainer = true;
  await ready();
  docker(['exec', '-i', name, 'node', '--input-type=module'], requestScript + `
    assert.equal((await send('/app', 'GET', undefined, { Authorization: 'Basic invalid' })).status, 401);
    const response = await send('/api/auth/register', 'POST', { name: 'Container fixture', email: 'container@example.test', role: 'customer',
      password: 'Disposable container password 123' }, { Origin: 'https://taxi.example.test', 'Content-Type': 'application/json' });
    assert.equal(response.status, 201);
    const cookie = response.headers['set-cookie'][0];
    assert.match(cookie, /^__Host-taxi_ai_session=/); assert.match(cookie, /; Secure$/);
    writeFileSync('/data/fixture-cookie', cookie.split(';')[0], { mode: 0o600 });
  `);
  docker(['restart', '--time', '25', name]); await ready();
  docker(['exec', '-i', name, 'node', '--input-type=module'], requestScript + `
    const response = await send('/api/session', 'GET', undefined, { Cookie: readFileSync('/data/fixture-cookie', 'utf8') });
    assert.equal(response.status, 200); assert.equal(JSON.parse(response.body).user.email, 'container@example.test');
  `);
  docker(['stop', '--time', '25', name]);
  if (docker(['inspect', '--format', '{{.State.ExitCode}}', name]).trim() !== '0') throw new Error('Container did not stop cleanly.');
  console.log('Container access, secure cookie, persistent restart, health and graceful shutdown passed.');
} catch (error) {
  // Docker error objects may include env/input. Never print them or container logs.
  console.error('Container check failed. Inspect the failing stage using disposable test configuration; credentials and request data are suppressed.');
  process.exitCode = 1;
} finally {
  if (createdContainer) { try { docker(['rm', '--force', name]); } catch { /* disposable CI resource */ } }
  if (createdVolume) { try { docker(['volume', 'rm', volume]); } catch { /* disposable CI resource */ } }
  rmSync(folder, { recursive: true, force: true });
}
