import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';
import { createCallConfig } from '../../../services/api/src/infrastructure/call-config.mjs';
import { createMapProvider } from '../../../services/api/src/infrastructure/map-provider.mjs';
import { importSpecifiers } from '../../../scripts/architecture-rules.mjs';

async function withServer(run, mode = 'local', maps = 'community') {
  const server = createAppServer({ callConfig: createCallConfig({ TAXI_AI_CALLS_MODE: mode }), mapProvider: createMapProvider({ env: { TAXI_AI_MAPS_MODE: maps } }) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('homepage, account and recipient pages serve their entire browser module dependency graph', async () => {
  await withServer(async (base) => {
    const pending = [], visited = new Set();
    for (const page of ['/', '/app', '/app?service=courier', '/eats/sell', '/parcels']) {
      const response = await fetch(base + page);
      assert.equal(response.status, 200, page);
      const scripts = [...(await response.text()).matchAll(/<script\b([^>]*)>/g)]
        .map((match) => match[1]).filter((attributes) => /\btype=["']module["']/.test(attributes));
      assert.ok(scripts.length > 0, `${page} must load a browser module`);
      for (const attributes of scripts) {
        const src = attributes.match(/\bsrc=["']([^"']+)["']/)?.[1];
        assert.ok(src, `${page} must use an external module allowed by its CSP`);
        pending.push({ url: new URL(src, base + page), parent: page });
      }
    }
    for (const { url, parent } of pending) {
      if (visited.has(url.href)) continue;
      visited.add(url.href);
      const context = `${url.pathname} imported by ${parent}`;
      assert.equal(url.origin, base, context);
      const response = await fetch(url);
      assert.equal(response.status, 200, context);
      assert.match(response.headers.get('content-type') ?? '', /^text\/javascript\b/, context);
      for (const specifier of importSpecifiers(await response.text())) {
        assert.match(specifier, /^(?:\/|\.\.?\/)/, `Browser import must resolve to a URL: ${specifier}`);
        pending.push({ url: new URL(specifier, url), parent: url.pathname });
      }
    }
  });
});

test('every homepage Courier entry navigates directly to served parcel booking without demo JavaScript', async () => {
  await withServer(async (base) => {
    const home = await (await fetch(base)).text();
    const links = [...home.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
      .filter((match) => /\bcourier\b/i.test(match[2].replace(/<[^>]*>/g, '')));
    assert.equal(links.length, 3, 'Navigation, service selector and service card must each offer a real Courier link');
    assert.ok(links.some((match) => /id="courier-booking-link"/.test(match[1])));
    for (const [, attributes] of links) {
      const href = attributes.match(/\bhref="([^"]+)"/)?.[1];
      assert.ok(href, 'Courier must work as a native browser link');
      const target = new URL(href, base);
      assert.equal(target.origin, base);
      assert.equal(target.pathname, '/app');
      assert.equal(target.searchParams.get('service'), 'courier');
      const response = await fetch(target);
      assert.equal(response.status, 200);
      const page = await response.text();
      assert.match(page, /id="auth-panel"/);
      assert.match(page, /id="delivery-details-form"/);
      assert.match(page, /src="\/dashboard.mjs"/);
    }
  });
});

test('the local site serves HTML, modules and artwork with correct content types', async () => {
  await withServer(async (base) => {
    for (const [path, type] of [['/', 'text/html'], ['/app', 'text/html'],
      ['/admin/coverage', 'text/html'], ['/admin/coverage-page.mjs', 'text/javascript'],
      ['/admin/coverage-map.mjs', 'text/javascript'], ['/admin/coverage-map-model.mjs', 'text/javascript'],
      ['/shared/nigeria-map-places.mjs', 'text/javascript'],
      ['/eats', 'text/html'], ['/eats.css', 'text/css'], ['/typography.css', 'text/css'], ['/eats.mjs', 'text/javascript'],
      ['/eats/view.mjs', 'text/javascript'], ['/eats/location-fields.mjs', 'text/javascript'],
      ['/shared/nigeria-areas.mjs', 'text/javascript'], ['/shared/nigeria-boundary.mjs', 'text/javascript'], ['/eats/transport.mjs', 'text/javascript'],
      ...['eats', 'eats-controller', 'eats-contracts'].map((name) => [`/shared/${name}.mjs`, 'text/javascript']),
      ['/trip-share', 'text/html'], ['/trip-share.mjs', 'text/javascript'], ['/shared/safety.mjs', 'text/javascript'],
      ['/guest-trip', 'text/html'], ['/guest-trip.mjs', 'text/javascript'],
      ...['safety-monitoring', 'safety-monitoring-controller', 'guest-rides', 'guest-rides-controller'].map((name) => [`/shared/${name}.mjs`, 'text/javascript']),
      ...['guest-rides-panel', 'guest-rides-transport', 'guest-trip-controller'].map((name) => [`/dashboard/${name}.mjs`, 'text/javascript']),
      ...['safety-monitoring', 'safety-sensors', 'safety-controller', 'safety-view', 'safety-format', 'trip-share-controller'].map((name) => [`/dashboard/${name}.mjs`, 'text/javascript']),
      ['/dashboard.css', 'text/css'], ['/dashboard.mjs', 'text/javascript'], ['/styles.css', 'text/css'],
      ['/homepage.css', 'text/css'],
      ['/homepage-carousel.mjs', 'text/javascript'],
      ['/dashboard/api-client.mjs', 'text/javascript'], ['/dashboard/auth-form.mjs', 'text/javascript'],
      ['/dashboard/page-controller.mjs', 'text/javascript'],
      ['/dashboard/dom.mjs', 'text/javascript'], ['/dashboard/views.mjs', 'text/javascript'],
      ['/dashboard/trip-model.mjs', 'text/javascript'], ['/dashboard/trip-view.mjs', 'text/javascript'],
      ['/shared/trip-lifecycle.mjs', 'text/javascript'],
      ['/shared/realtime-client.mjs', 'text/javascript'],
      ['/shared/chat-safety.mjs', 'text/javascript'],
      ['/shared/pickup-identity.mjs', 'text/javascript'],
      ['/shared/account-modes.mjs', 'text/javascript'], ['/dashboard/account-mode-view.mjs', 'text/javascript'],
      ['/dashboard/call-controller.mjs', 'text/javascript'], ['/dashboard/call-media.mjs', 'text/javascript'],
      ['/dashboard/call-view.mjs', 'text/javascript'], ['/shared/call-lifecycle.mjs', 'text/javascript'],
      ...['map-view', 'location-planner', 'location-view', 'location-sharing', 'geolocation', 'availability-controller', 'availability-view', 'payments-controller', 'payments-view'].map((name) => [`/dashboard/${name}.mjs`, 'text/javascript']),
      ['/eats/sell', 'text/html'], ['/assets/fonts/manrope-latin-wght-normal.woff2', 'font/woff2'], ['/assets/fonts/manrope-latin-ext-wght-normal.woff2', 'font/woff2'], ['/shared/payments.mjs', 'text/javascript'], ['/shared/kemmy.mjs', 'text/javascript'],
      ['/shared/locations.mjs', 'text/javascript'], ['/shared/matching.mjs', 'text/javascript'],
      ['/dashboard/conversation-model.mjs', 'text/javascript'],
      ['/dashboard/conversation-controller.mjs', 'text/javascript'],
      ['/dashboard/conversation-view.mjs', 'text/javascript'],
      ['/dashboard/chat-reports-view.mjs', 'text/javascript'],
      ['/app.mjs', 'text/javascript'], ['/shared/fare-negotiation.mjs', 'text/javascript'],
      ['/shared/demo-booking.mjs', 'text/javascript'], ['/assets/city-route-hero.webp', 'image/webp'],
      ['/assets/city-route-hero-small.webp', 'image/webp'],
      ...['airport-dropoff', 'food-delivery', 'courier-delivery'].flatMap((name) =>
        ['', '-small'].map((size) => [`/assets/${name}-hero${size}.webp`, 'image/webp'])),
      ['/assets/autonomous-concept.webp', 'image/webp'],
      ['/assets/autonomous-concept-small.webp', 'image/webp'], ['/favicon.svg?v=amber', 'image/svg+xml'],
      ['/assets/taxi-ai-mark.svg', 'image/svg+xml'], ['/assets/taxi-ai-phone-preview.svg', 'image/svg+xml'], ['/assets/ai-journey-features.webp', 'image/webp'], ['/assets/ai-journey-features-small.webp', 'image/webp'], ['/assets/kemmy-avatar.png', 'image/png']]) {
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
      assert.equal(policy, `camera=${path.startsWith('/app') ? '(self)' : '()'}, microphone=${path.startsWith('/app') ? '(self)' : '()'}, geolocation=${path.startsWith('/app') || path === '/eats' ? '(self)' : '()'}, accelerometer=${path.startsWith('/app') ? '(self)' : '()'}, gyroscope=${path.startsWith('/app') ? '(self)' : '()'}`);
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
