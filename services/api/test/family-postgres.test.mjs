import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { openPostgresDatabase } from '../src/infrastructure/postgres.mjs';
import { createApplication } from '../src/application.mjs';
import { createAppServer } from '../../../apps/web/server.mjs';
import { createWorkerConfig } from '../src/infrastructure/worker-config.mjs';
import { createCallConfig } from '../src/infrastructure/call-config.mjs';
import { createMapProvider } from '../src/infrastructure/map-provider.mjs';
import { submitApplication, approveApplication } from './driver-fixtures.mjs';

const connectionString = process.env.TAXI_AI_TEST_POSTGRES_URL;
const serialOnly = process.env.TAXI_AI_TEST_POSTGRES_SERIAL_ONLY === '1';
const paired = async action => serialOnly ? [await action(0), await action(1)] : await Promise.all([0, 1].map(action));
const password = 'Family PostgreSQL fictional test password 123';
const must = (response, status = 200) => { assert.equal(response.status, status, JSON.stringify(response.body)); return response.body; };

test('PostgreSQL family consent, concurrent retries and revoked views agree across two independent API pools', {
  skip: !connectionString && 'Set TAXI_AI_TEST_POSTGRES_URL to an isolated PostgreSQL/PostGIS test database.', timeout: 120000,
}, async t => {
  if (serialOnly) t.diagnostic('Embedded PostgreSQL compatibility mode serializes requests; concurrency and capacity are not tested.');
  const schema = `test_family_${randomUUID().replaceAll('-', '')}`;
  const control = await openPostgresDatabase({ connectionString, schema, max: 1, migrate: true });
  const instances = [];
  try {
    for (let index = 0; index < 2; index++) {
      const db = await openPostgresDatabase({ connectionString, schema, max: serialOnly ? 1 : 2 });
      const server = createAppServer({ db, workerConfig: createWorkerConfig({ TAXI_AI_PROCESS_ROLE: 'api' }),
        callConfig: createCallConfig({ TAXI_AI_CALLS_MODE: 'off' }), mapProvider: createMapProvider({ env: { TAXI_AI_MAPS_MODE: 'off' } }),
        dispatchConfig: { mode: 'legacy' } });
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      instances.push({ server, base: `http://127.0.0.1:${server.address().port}` });
    }
    function client() {
      const state = { user: null, cookie: '', csrf: '' }, availabilityClient = randomUUID();
      async function send(index, path, data, key = randomUUID(), extra = {}) {
        const { base } = instances[index];
        const response = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST',
          headers: { ...(state.cookie ? { Cookie: state.cookie } : {}), ...(data === undefined ? {} : {
            Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf, 'Idempotency-Key': key }), ...extra },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
        const cookie = response.headers.get('set-cookie'); if (cookie) state.cookie = cookie.split(';')[0];
        const body = await response.json();
        if (Object.hasOwn(body, 'csrfToken')) state.csrf = body.csrfToken;
        if (Object.hasOwn(body, 'user')) state.user = body.user;
        return { status: response.status, body };
      }
      return { state, send, availabilityClient,
        async register(index, name, role = 'customer') { return must(await send(index, '/api/auth/register', { name, email: `${name}@example.test`, password, role,
          ...(role === 'driver' ? { vehicle: { model: 'Toyota Corolla', plate: 'FAMILY-PG' } } : {}) }), 201); },
        api: { request: async path => must(await send(0, path)), command: async (path, data) => must(await send(1, path, data)) } };
    }
    const owner = client(), observer = client(), stranger = client(), driver = client(), staff = client();
    await owner.register(0, 'pg-family-owner'); await observer.register(1, 'pg-family-observer'); await stranger.register(0, 'pg-family-stranger');
    await driver.register(1, 'pg-family-driver', 'driver'); await staff.register(0, 'pg-family-staff');
    await createApplication({ db: control }).accounts.bootstrapAdmin(staff.state.user.email);
    must(await staff.send(1, '/api/auth/login', { email: staff.state.user.email, password }));
    await submitApplication(driver.api); await approveApplication(staff.api, driver.state.user.id);
    must(await driver.send(0, '/api/availability/online', { mode: 'sample', areaId: 'wuse-ii' }, randomUUID(), { 'X-Availability-Client': driver.availabilityClient }));
    const beforeObserver = must(await observer.send(1, '/api/events?wait=0')).cursor;
    const beforeStranger = must(await stranger.send(0, '/api/events?wait=0')).cursor;
    const invited = must(await owner.send(0, '/api/family/invite', { email: observer.state.user.email, adultConfirmed: true })).family.contacts[0];
    assert.equal(must(await observer.send(1, '/api/family')).family.contacts[0].id, invited.id);
    assert.ok(BigInt(must(await observer.send(1, '/api/events?wait=0')).cursor) > BigInt(beforeObserver));
    assert.equal(must(await stranger.send(1, '/api/events?wait=0')).cursor, beforeStranger);
    const acceptance = { contactId: invited.id, expectedVersion: invited.version, adultConfirmed: true }, acceptKey = randomUUID();
    const accepted = await paired(index => observer.send(index, '/api/family/accept', acceptance, acceptKey));
    assert.deepEqual(accepted.map(response => response.status), [200, 200]);
    assert.deepEqual(accepted.map(response => response.body.replayed).sort(), [false, true]);
    assert.equal((await control.prepare('SELECT count(*) AS n FROM family_contacts WHERE status=?').get('active')).n, 1);
    let ride = must(await owner.send(0, '/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama' }), 201).ride;
    const change = async (actor, action, data = {}) => { ride = must(await actor.send(1, `/api/rides/${ride.id}/${action}`, { expectedVersion: ride.version, ...data })).ride; };
    await change(driver, 'claim'); await change(driver, 'offers', { amountKobo: 470000 });
    await change(owner, 'accept', { offerId: ride.negotiation.currentOffer.id }); await change(owner, 'confirm');
    assert.equal(must(await observer.send(1, '/api/family')).family.trips.length, 0);
    const sharing = { rideId: ride.id, contactId: invited.id }, shareKey = randomUUID();
    const grants = await paired(index => owner.send(index, '/api/family/share', sharing, shareKey));
    assert.deepEqual(grants.map(response => response.status), [200, 200]);
    assert.deepEqual(grants.map(response => response.body.replayed).sort(), [false, true]);
    const trip = must(await observer.send(1, '/api/family')).family.trips[0], path = `/api/family/trips/${trip.shareId}`;
    const detail = must(await observer.send(0, path)).trip;
    assert.equal(detail.location, null); assert.equal(detail.driver.name, driver.state.user.name);
    assert.equal(Object.hasOwn(detail, 'pickupPin'), false); assert.equal(Object.hasOwn(detail, 'negotiation'), false);
    assert.equal((await observer.send(0, `/api/rides/${ride.id}`)).status, 404);
    assert.equal((await stranger.send(1, path)).status, 404);
    must(await observer.send(0, '/api/family/request-check-in', { shareId: trip.shareId, expectedVersion: trip.version }));
    const current = must(await owner.send(1, path)).trip;
    must(await owner.send(1, '/api/family/respond', { shareId: trip.shareId, expectedVersion: current.version, response: 'okay' }));
    assert.equal(must(await observer.send(0, path)).trip.checkIn.response, 'okay');
    const contact = must(await owner.send(1, '/api/family')).family.contacts.find(row => row.id === invited.id);
    must(await owner.send(0, '/api/family/revoke-contact', { contactId: contact.id, expectedVersion: contact.version }));
    assert.equal((await observer.send(1, path)).status, 404);
    assert.equal(must(await observer.send(0, '/api/family')).family.trips.length, 0);
    assert.equal(must(await owner.send(1, '/api/family/share', sharing, shareKey)).replayed, true);
    assert.equal((await observer.send(0, path)).status, 404);
    assert.equal(must(await observer.send(0, '/api/family')).family.inbox.some(event => event.shareId === trip.shareId), false);
  } finally {
    for (const { server } of instances) { server.beginShutdown(); await new Promise(resolve => server.close(resolve)); await server.closeResources(); }
    await control.exec(`DROP SCHEMA "${schema}" CASCADE`); await control.close();
  }
});
