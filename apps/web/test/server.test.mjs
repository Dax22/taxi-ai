import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDemoServer } from '../server.mjs';

async function withServer(run) {
  const server = createDemoServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('the local site serves HTML, modules and artwork with correct content types', async () => {
  await withServer(async (base) => {
    for (const [path, type] of [['/', 'text/html'], ['/styles.css', 'text/css'],
      ['/app.mjs', 'text/javascript'], ['/shared/fare-negotiation.mjs', 'text/javascript'],
      ['/shared/demo-booking.mjs', 'text/javascript'], ['/assets/taxi-hero.webp', 'image/webp'],
      ['/assets/autonomous.webp', 'image/webp'], ['/favicon.svg', 'image/svg+xml']]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.ok(response.headers.get('content-type').startsWith(type), path);
      assert.ok((await response.arrayBuffer()).byteLength > 0, path);
    }
  });
});

test('the static server never exposes repository files or writable endpoints', async () => {
  await withServer(async (base) => {
    for (const path of ['/.env', '/package.json', '/server.mjs', '/../../README.md',
      '/%2e%2e/%2e%2e/README.md', '/shared/../../.git/config', '/unknown']) {
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
    assert.match(head.headers.get('content-security-policy'), /connect-src 'none'/);
    assert.equal(head.headers.get('x-content-type-options'), 'nosniff');
  });
});
