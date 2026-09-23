import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';
import { createCallConfig } from '../../../services/api/src/infrastructure/call-config.mjs';
import { createMapProvider } from '../../../services/api/src/infrastructure/map-provider.mjs';

async function withServer(run, mode = 'local', maps = 'community') {
  const server = createAppServer({ callConfig: createCallConfig({ TAXI_AI_CALLS_MODE: mode }), mapProvider: createMapProvider({ env: { TAXI_AI_MAPS_MODE: maps } }) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('the local site serves HTML, modules and artwork with correct content types', async () => {
  await withServer(async (base) => {
    for (const [path, type] of [['/', 'text/html'], ['/app', 'text/html'],
      ['/eats', 'text/html'], ['/eats.css', 'text/css'], ['/typography.css', 'text/css'], ['/eats.mjs', 'text/javascript'],
      ['/eats/view.mjs', 'text/javascript'], ['/eats/location-fields.mjs', 'text/javascript'],
      ['/shared/nigeria-areas.mjs', 'text/javascript'], ['/shared/nigeria-boundary.mjs', 'text/javascript'], ['/eats/transport.mjs', 'text/javascript'],
      ...['eats', 'eats-controller', 'eats-contracts'].map((name) => [`/shared/${name}.mjs`, 'text/javascript']),
      ['/trip-share', 'text/html'], ['/trip-share.mjs', 'text/javascript'], ['/shared/safety.mjs', 'text/javascript'],
      ['/guest-trip', 'text/html'], ['/guest-trip.mjs', 'text/javascript'],
      ...['guest-rides', 'guest-rides-controller'].map((name) => [`/shared/${name}.mjs`, 'text/javascript']),
      ...['guest-rides-panel', 'guest-rides-transport', 'guest-trip-controller'].map((name) => [`/dashboard/${name}.mjs`, 'text/javascript']),
      ...['safety-controller', 'safety-view', 'safety-format', 'trip-share-controller'].map((name) => [`/dashboard/${name}.mjs`, 'text/javascript']),
      ['/dashboard.css', 'text/css'], ['/dashboard.mjs', 'text/javascript'], ['/styles.css', 'text/css'],
      ['/homepage.css', 'text/css'],
      ['/dashboard/api-client.mjs', 'text/javascript'], ['/dashboard/auth-form.mjs', 'text/javascript'],
      ['/dashboard/page-controller.mjs', 'text/javascript'],
      ['/dashboard/dom.mjs', 'text/javascript'], ['/dashboard/views.mjs', 'text/javascript'],
      ['/dashboard/trip-model.mjs', 'text/javascript'], ['/dashboard/trip-view.mjs', 'text/javascript'],
      ['/shared/trip-lifecycle.mjs', 'text/javascript'],
      ['/shared/chat-safety.mjs', 'text/javascript'],
      ['/shared/pickup-identity.mjs', 'text/javascript'],
      ['/shared/account-modes.mjs', 'text/javascript'], ['/dashboard/account-mode-view.mjs', 'text/javascript'],
      ['/dashboard/call-controller.mjs', 'text/javascript'], ['/dashboard/call-media.mjs', 'text/javascript'],
      ['/dashboard/call-view.mjs', 'text/javascript'], ['/shared/call-lifecycle.mjs', 'text/javascript'],
      ...['map-view', 'location-planner', 'location-view', 'location-sharing', 'geolocation', 'availability-controller', 'availability-view', 'payments-controller', 'payments-view'].map((name) => [`/dashboard/${name}.mjs`, 'text/javascript']),
      ['/shared/payments.mjs', 'text/javascript'],
      ['/shared/locations.mjs', 'text/javascript'], ['/shared/matching.mjs', 'text/javascript'],
      ['/dashboard/conversation-model.mjs', 'text/javascript'],
      ['/dashboard/conversation-controller.mjs', 'text/javascript'],
      ['/dashboard/conversation-view.mjs', 'text/javascript'],
      ['/dashboard/chat-reports-view.mjs', 'text/javascript'],
      ['/app.mjs', 'text/javascript'], ['/shared/fare-negotiation.mjs', 'text/javascript'],
      ['/shared/demo-booking.mjs', 'text/javascript'], ['/assets/city-route-hero.webp', 'image/webp'],
      ['/assets/city-route-hero-small.webp', 'image/webp'],
      ['/assets/autonomous-concept.webp', 'image/webp'],
      ['/assets/autonomous-concept-small.webp', 'image/webp'], ['/favicon.svg?v=amber', 'image/svg+xml'],
      ['/assets/taxi-ai-mark.svg', 'image/svg+xml']]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.ok(response.headers.get('content-type').startsWith(type), path);
      assert.ok((await response.arrayBuffer()).byteLength > 0, path);
    }
  });
});

test('camera and microphone are account-only; explicit work geolocation is also permitted in Eats; only configured tiles can load externally', async () => {
  for (const mode of ['local', 'off']) await withServer(async (base) => {
    for (const path of ['/', '/app', '/app?preview=1', '/eats', '/api/session', '/trip-share', '/guest-trip']) {
      const result = await fetch(base + path);
      const policy = result.headers.get('permissions-policy');
      assert.equal(policy, `camera=${path.startsWith('/app') ? '(self)' : '()'}, microphone=${path.startsWith('/app') && mode !== 'off' ? '(self)' : '()'}, geolocation=${path.startsWith('/app') || path === '/eats' ? '(self)' : '()'}`);
      assert.match(result.headers.get('content-security-policy'), /media-src 'self' blob:/);
      assert.match(result.headers.get('content-security-policy'), /img-src 'self' https:\/\/tile.openstreetmap.org/);
      assert.match(result.headers.get('content-security-policy'), /connect-src 'self'/);
      assert.equal(result.headers.get('referrer-policy'), path.startsWith('/app') ? 'strict-origin-when-cross-origin' : 'no-referrer');
      await result.text();
    }
  }, mode);
  await withServer(async (base) => {
    const result = await fetch(base + '/app');
    assert.ok(!result.headers.get('content-security-policy').includes('tile.openstreetmap.org'));
    assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
    assert.match(result.headers.get('permissions-policy'), /geolocation=\(self\)/);
    await result.text();
  }, 'off', 'off');
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
