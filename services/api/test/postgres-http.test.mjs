import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import sharp from 'sharp';
import { openPostgresDatabase } from '../src/infrastructure/postgres.mjs';
import { createApplication } from '../src/application.mjs';
import { createAppServer } from '../../../apps/web/server.mjs';
import { createWorkerConfig } from '../src/infrastructure/worker-config.mjs';
import { createCallConfig } from '../src/infrastructure/call-config.mjs';
import { createMapProvider } from '../src/infrastructure/map-provider.mjs';
import { submitApplication, approveApplication } from './driver-fixtures.mjs';

const connectionString = process.env.TAXI_AI_TEST_POSTGRES_URL;
const password = 'Postgres integration test password 123';
const details = { name: 'Postgres Test Kitchen', cuisine: 'Nigerian', description: 'Fictional PostgreSQL test restaurant.',
  address: '10 Fictional Street, Wuse II', areaId: 'wuse-ii', deliveryAreaIds: ['wuse-ii','maitama'],
  prepMinutes: 20, minimumKobo: 100000, deliveryFeeKobo: 150000 };
const item = { name: 'Jollof rice', description: 'Fictional test dish.', category: 'Meals', priceKobo: 250000, available: true };
const must = (result, status = 200) => { assert.equal(result.status, status, JSON.stringify(result.body)); return result.body; };

/** Runs unchanged against a dedicated native PostgreSQL/PostGIS server. The
 * optional embedded wire harness covers SQL compatibility, not load capacity. */
test('PostgreSQL HTTP: shared sessions, account invalidations, Eats photos and admin reports across two API instances', {
  skip: !connectionString && 'Set TAXI_AI_TEST_POSTGRES_URL to an isolated PostgreSQL/PostGIS test database.', timeout: 120000,
}, async t => {
  const schema = `test_http_${randomUUID().replaceAll('-', '')}`;
  const control = await openPostgresDatabase({ connectionString, schema, max: 1, migrate: true });
  const replicas = [];
  try {
    for (let index = 0; index < 2; index++) {
      const db = await openPostgresDatabase({ connectionString, schema, max: 1 });
      const server = createAppServer({ db, workerConfig: createWorkerConfig({ TAXI_AI_PROCESS_ROLE: 'api' }),
        callConfig: createCallConfig({ TAXI_AI_CALLS_MODE: 'off' }), mapProvider: createMapProvider({ env: { TAXI_AI_MAPS_MODE: 'off' } }),
        dispatchConfig: { mode: 'legacy' } });
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      replicas.push({ server, base: `http://127.0.0.1:${server.address().port}` });
    }
    function browser() {
      const state = { cookie: '', csrf: '', user: null };
      async function send(index, path, data, key = randomUUID()) {
        const { base } = replicas[index];
        const response = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST',
          headers: { ...(state.cookie ? { Cookie: state.cookie } : {}), ...(data === undefined ? {} : {
            Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf, 'Idempotency-Key': key }) },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
        const cookie = response.headers.get('set-cookie'); if (cookie) state.cookie = cookie.split(';')[0];
        const body = await response.json();
        if (Object.hasOwn(body, 'csrfToken')) state.csrf = body.csrfToken;
        if (Object.hasOwn(body, 'user')) state.user = body.user;
        return { status: response.status, body, headers: response.headers };
      }
      return { state, send, async register(index, name) { return must(await send(index, '/api/auth/register', { name, email: `${name}@example.test`, password }), 201); } };
    }
    async function native(index, path, token, data) {
      const response = await fetch(replicas[index].base + '/api/mobile/v1' + path, { method: data === undefined ? 'GET' : 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }) },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
      return { status: response.status, body: await response.json() };
    }
    const customer = browser(), seller = browser(), staff = browser(), stranger = browser();
    await customer.register(0, 'pg-customer'); await seller.register(1, 'pg-seller'); await staff.register(0, 'pg-staff'); await stranger.register(1, 'pg-stranger');
    const app = createApplication({ db: control }); await app.accounts.bootstrapAdmin(staff.state.user.email);
    must(await staff.send(1, '/api/admin/console/login', { email: staff.state.user.email, password }));

    await t.test('browser and native credentials work across independent application pools', async () => {
      assert.equal(must(await customer.send(1, '/api/session')).user.id, customer.state.user.id);
      assert.equal(must(await seller.send(0, '/api/session')).user.id, seller.state.user.id);
      const login = must(await native(1, '/auth/login', null, { email: customer.state.user.email, password, deviceName: 'PG test phone' }));
      assert.equal(must(await native(0, '/session', login.credentials.accessToken)).user.id, customer.state.user.id);
      must(await native(1, '/auth/logout', null, { refreshToken: login.credentials.refreshToken }));
      assert.equal((await native(0, '/session', login.credentials.accessToken)).status, 401);
      assert.equal((await stranger.send(0, '/api/admin/console/accounts')).status, 403);
    });

    await t.test('committed ride changes invalidate only participants and are visible across replicas', async () => {
      const before = must(await customer.send(1, '/api/events?cursor=0&wait=0'));
      const ride = must(await customer.send(0, '/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama' }), 201).ride;
      assert.equal(must(await customer.send(1, `/api/rides/${ride.id}`)).ride.id, ride.id);
      const changed = await customer.send(1, `/api/events?cursor=${before.cursor}&wait=0`);
      assert.equal(must(changed).changed, true); assert.equal(changed.headers.get('cache-control'), 'no-store');
      assert.deepEqual(Object.keys(changed.body).sort(), ['changed','cursor','serverNow']);
      assert.equal(must(await stranger.send(0, '/api/events?cursor=0&wait=0')).changed, false);
      assert.equal((await stranger.send(1, `/api/rides/${ride.id}`)).status, 404);
      assert.equal((await customer.send(0, `/api/events?wait=0&userId=${stranger.state.user.id}`)).status, 400);
    });

    await t.test('seller photo bytes, quotes and orders persist with owner checks across both transports', async () => {
      let { store } = must(await seller.send(0, '/api/eats/stores', { details }));
      ({ store } = must(await seller.send(1, `/api/eats/stores/${store.id}/menu`, { expectedVersion: store.version, itemId: null, item })));
      const menu = must(await seller.send(0, '/api/eats/store')).menu, itemId = menu[0].id;
      const png = await sharp({ create: { width: 420, height: 320, channels: 3, background: '#b84b29' } }).png().toBuffer();
      const payload = { expectedVersion: store.version, itemId, image: { mimeType: 'image/png', base64: png.toString('base64') } };
      assert.equal((await stranger.send(0, `/api/eats/stores/${store.id}/photo`, payload)).status, 403);
      const photo = must(await seller.send(1, `/api/eats/stores/${store.id}/photo`, payload)); store = photo.store;
      assert.equal(JSON.stringify(photo).includes(payload.image.base64), false);
      const imagePath = `/api/eats/images/${itemId}?v=${store.version}`;
      const privateImage = await fetch(replicas[0].base + imagePath, { headers: { Cookie: seller.state.cookie } });
      assert.equal(privateImage.status, 200); assert.equal(privateImage.headers.get('content-type'), 'image/jpeg');
      const metadata = await sharp(Buffer.from(await privateImage.arrayBuffer())).metadata();
      assert.equal(metadata.format, 'jpeg'); assert.equal(metadata.exif, undefined);
      assert.equal((await fetch(replicas[1].base + imagePath, { headers: { Cookie: customer.state.cookie } })).status, 404);
      ({ store } = must(await staff.send(0, `/api/eats/stores/${store.id}/review`, { expectedVersion: store.version, decision: 'approved', reason: 'Fictional integration test kitchen reviewed.', reference: 'PG-TEST' })));
      ({ store } = must(await seller.send(1, `/api/eats/stores/${store.id}/open`, { expectedVersion: store.version, isOpen: true })));
      const catalog = must(await customer.send(0, '/api/eats/restaurants?q=jollof'));
      assert.equal(catalog.dishes.length, 1);
      assert.equal((await fetch(replicas[1].base + imagePath, { headers: { Cookie: customer.state.cookie } })).status, 200);
      const quote = must(await customer.send(0, '/api/eats/quotes', { storeId: store.id, expectedVersion: store.version,
        items: [{ itemId, quantity: 2 }], address: { line: '25 Fictional Close', areaId: 'maitama' }, instructions: 'Test handover.' })).quote;
      const order = must(await customer.send(1, '/api/eats/orders', { quoteId: quote.id })).order;
      assert.equal(must(await seller.send(0, `/api/eats/orders/${order.id}`)).order.id, order.id);
      assert.equal((await stranger.send(1, `/api/eats/orders/${order.id}`)).status, 404);
      const login = must(await native(1, '/auth/login', null, { email: customer.state.user.email, password, deviceName: 'Eats PG phone' }));
      assert.equal(must(await native(0, `/eats/orders/${order.id}`, login.credentials.accessToken)).order.id, order.id);
    });

    await t.test('PostgreSQL aggregates and account reports remain authenticated across replicas', async () => {
      const accounts = must(await staff.send(1, '/api/admin/console/accounts'));
      assert.equal(accounts.counts.total, 3); // Staff identities are excluded from customer reporting.
      for (const path of ['/api/admin/console/trips', '/api/admin/console/analytics', `/api/admin/console/accounts/${customer.state.user.id}`]) {
        must(await staff.send(0, path));
      }
    });

    await t.test('driver registration, document storage and approval share the PostgreSQL transaction boundary', async () => {
      const driver = browser();
      must(await driver.send(0, '/api/auth/register', { name: 'pg-driver', email: 'pg-driver@example.test', password,
        role: 'driver', vehicle: { model: 'Toyota Corolla', plate: 'PG-DRIVER' } }), 201);
      const driverApi = { request: async path => must(await driver.send(0, path)), command: async (path, data) => must(await driver.send(1, path, data)) };
      const staffApi = { request: async path => must(await staff.send(1, path)), command: async (path, data) => must(await staff.send(0, path, data)) };
      await submitApplication(driverApi); await approveApplication(staffApi, driver.state.user.id);
      const login = must(await native(1, '/auth/login', null, { email: driver.state.user.email, password, deviceName: 'Driver PG phone' }));
      const onboarding = must(await native(0, '/driver/onboarding', login.credentials.accessToken));
      assert.equal(onboarding.application.status, 'approved'); assert.equal(onboarding.application.documents.length, 5);
      const work = must(await native(1, `/work?clientId=${randomUUID()}`, login.credentials.accessToken));
      assert.ok(Array.isArray(work.available));
    });
  } finally {
    for (const { server } of replicas) { server.beginShutdown(); await new Promise(resolve => server.close(resolve)); await server.closeResources(); }
    await control.exec(`DROP SCHEMA "${schema}" CASCADE`); await control.close();
  }
});
