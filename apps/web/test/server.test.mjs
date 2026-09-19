import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';
import { createCallConfig } from '../../../services/api/src/infrastructure/call-config.mjs';

async function withServer(run, mode = 'local') {
  const server = createAppServer({ callConfig: createCallConfig({ TAXI_AI_CALLS_MODE: mode }) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('the local site serves HTML, modules and artwork with correct content types', async () => {
  await withServer(async (base) => {
    for (const [path, type] of [['/', 'text/html'], ['/app', 'text/html'],
      ['/dashboard.css', 'text/css'], ['/dashboard.mjs', 'text/javascript'], ['/styles.css', 'text/css'],
      ['/dashboard/api-client.mjs', 'text/javascript'], ['/dashboard/auth-form.mjs', 'text/javascript'],
      ['/dashboard/dom.mjs', 'text/javascript'], ['/dashboard/views.mjs', 'text/javascript'],
      ['/dashboard/trip-model.mjs', 'text/javascript'], ['/dashboard/trip-view.mjs', 'text/javascript'],
      ['/shared/trip-lifecycle.mjs', 'text/javascript'],
      ['/dashboard/call-controller.mjs', 'text/javascript'], ['/dashboard/call-media.mjs', 'text/javascript'],
      ['/dashboard/call-view.mjs', 'text/javascript'], ['/shared/call-lifecycle.mjs', 'text/javascript'],
      ['/dashboard/conversation-model.mjs', 'text/javascript'],
      ['/dashboard/conversation-controller.mjs', 'text/javascript'],
      ['/dashboard/conversation-view.mjs', 'text/javascript'],
      ['/dashboard/chat-reports-view.mjs', 'text/javascript'],
      ['/app.mjs', 'text/javascript'], ['/shared/fare-negotiation.mjs', 'text/javascript'],
      ['/shared/demo-booking.mjs', 'text/javascript'], ['/assets/taxi-hero.webp', 'image/webp'],
      ['/assets/autonomous.webp', 'image/webp'], ['/favicon.svg?v=amber', 'image/svg+xml'],
      ['/assets/taxi-ai-mark.svg', 'image/svg+xml']]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.ok(response.headers.get('content-type').startsWith(type), path);
      assert.ok((await response.arrayBuffer()).byteLength > 0, path);
    }
  });
});

test('microphone permission is scoped to the enabled account page, with camera and geolocation still disabled', async () => {
  for (const mode of ['local', 'off']) await withServer(async (base) => {
    for (const path of ['/', '/app', '/app?preview=1', '/api/session']) {
      const result = await fetch(base + path);
      const policy = result.headers.get('permissions-policy');
      assert.equal(policy, `camera=(), microphone=${path.startsWith('/app') && mode !== 'off' ? '(self)' : '()'}, geolocation=()`);
      assert.match(result.headers.get('content-security-policy'), /media-src 'self' blob:/);
      await result.text();
    }
  }, mode);
});

test('the static routes never expose repository files or accept writes', async () => {
  await withServer(async (base) => {
    for (const path of ['/.env', '/package.json', '/server.mjs', '/../../README.md',
      '/%2e%2e/%2e%2e/README.md', '/shared/../../.git/config', '/data/taxi-ai.sqlite', '/unknown']) {
      const response = await fetch(base + path);
      assert.equal(response.status, 404, path);
      await response.text();
    }
    const post = await fetch(base, { method: 'POST', body: 'not a real booking' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
    await post.text();
    const head = await fetch(base, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.match(head.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.equal(head.headers.get('x-content-type-options'), 'nosniff');
  });
});
