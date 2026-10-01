import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, bootstrapAdmin, PASSWORD } from './helpers.mjs';

const profilePath = '/api/eats/delivery-profile', lookupPath = '/api/eats/delivery-location';
const address = { line: '18 Fictional Customer Close, blue gate', areaId: 'wuse-ii', point: { lat: 9.08, lng: 7.4 } };
const work = { line: '91 Fictional Customer Office, lobby', areaId: 'maitama' };
const must = (response) => { assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body; };
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
async function fixture(t, options = {}) {
  const h = await harness(t, options), customer = h.client(), other = h.client();
  await customer.register('delivery-security-customer'); await other.register('delivery-security-other');
  return { h, customer, other };
}
async function phone(h, customer) {
  const login = await customer.send('/api/mobile/v1/auth/login', { method: 'POST',
    data: { email: customer.user.email, password: PASSWORD, deviceName: 'Delivery privacy test phone' },
    headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null } });
  const credentials = must(login).credentials, token = credentials.accessToken;
  return {
    token, sessionId: credentials.sessionId,
    send: (path, data) => h.client().send('/api/mobile/v1/eats' + path, {
      ...(data === undefined ? {} : { method: 'POST', data }),
      headers: { Origin: null, Cookie: null, 'X-CSRF-Token': null, Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() },
    }),
  };
}

test('saved Home and Work delivery addresses stay account-owned across web and native and reject target-account fields', async (t) => {
  const { h, customer, other } = await fixture(t);
  assert.equal((await h.client().send(profilePath)).status, 401);
  const empty = must(await customer.send(profilePath)).deliveryProfile;
  assert.deepEqual(empty, { version: 0, addresses: { home: null, work: null } });
  const data = { expectedVersion: 0, label: 'home', address }, key = randomUUID();
  const saved = must(await customer.post(profilePath, data, key));
  assert.equal(saved.deliveryProfile.version, 1); assert.deepEqual(saved.deliveryProfile.addresses.home, address);
  assert.equal(must(await customer.post(profilePath, data, key)).replayed, true);
  assert.deepEqual(must(await other.send(profilePath)).deliveryProfile, empty);
  for (const extra of [{ userId: other.user.id }, { customerId: other.user.id }, { ownerId: other.user.id }]) {
    assert.equal((await customer.post(profilePath, { expectedVersion: 1, label: 'work', address: work, ...extra })).status, 400);
  }
  assert.equal((await other.send(profilePath + '/' + customer.user.id)).status, 404);
  const native = await phone(h, customer), otherPhone = await phone(h, other);
  assert.deepEqual(must(await native.send('/delivery-profile')).deliveryProfile.addresses.home, address);
  assert.deepEqual(must(await otherPhone.send('/delivery-profile')).deliveryProfile, empty);
  const savedWork = must(await native.send('/delivery-profile', { expectedVersion: 1, label: 'work', address: work })).deliveryProfile;
  assert.equal(savedWork.version, 2); assert.deepEqual(savedWork.addresses.work, work);
  assert.deepEqual(must(await customer.send(profilePath)).deliveryProfile, savedWork);
  const replay = must(await customer.post(profilePath, data, key));
  assert.equal(replay.replayed, true); assert.deepEqual(replay.deliveryProfile, savedWork, 'Retry returns current owned profile, not an old address snapshot.');
  assert.equal((await h.client().send(profilePath, { headers: { Authorization: `Bearer ${native.token}` } })).status, 401);
});

test('delivery-profile writes require browser CSRF, enforce versions and two valid slots, and let owners remove saved points', async (t) => {
  const { h, customer } = await fixture(t);
  const first = { expectedVersion: 0, label: 'home', address };
  for (const headers of [{ 'X-CSRF-Token': 'forged' }, { Origin: 'https://untrusted.example.test' }]) {
    assert.equal((await customer.send(profilePath, { method: 'POST', data: first, headers: { ...headers, 'Idempotency-Key': randomUUID() } })).status, 403);
  }
  assert.equal(must(await customer.send(profilePath)).deliveryProfile.version, 0);
  const variants = [
    { ...first, label: 'vacation' }, { ...first, expectedVersion: -1 }, { ...first, address: { ...address, phone: '+2348012345678' } },
    { ...first, address: { ...address, point: { lat: 41.8781, lng: -87.6298 } } },
    { ...first, address: { ...address, point: { ...address.point, userId: customer.user.id } } },
    { ...first, address: { ...address, areaId: 'not-a-real-area' } },
  ];
  for (const data of variants) assert.equal((await customer.post(profilePath, data)).status, 400, JSON.stringify(data));
  const race = await Promise.all([customer.post(profilePath, first), customer.post(profilePath, { ...first, label: 'work', address: work })]);
  assert.deepEqual(race.map((result) => result.status).sort(), [200, 409]);
  const current = must(await customer.send(profilePath)).deliveryProfile;
  assert.equal(current.version, 1); assert.equal(Object.values(current.addresses).filter(Boolean).length, 1);
  const label = current.addresses.home ? 'home' : 'work';
  const removed = must(await customer.post(profilePath, { expectedVersion: 1, label, address: null })).deliveryProfile;
  assert.deepEqual(removed, { version: 2, addresses: { home: null, work: null } });
  const history = JSON.stringify(h.db.prepare('SELECT * FROM eats_commands').all()) + JSON.stringify(h.db.prepare('SELECT * FROM audit_events').all());
  assert.equal(history.includes(address.line), false); assert.equal(history.includes(work.line), false, 'Saved addresses are not copied into command receipts or audit history.');
  const oldCookie = customer.cookie, oldCsrf = customer.csrf;
  must(await customer.post('/api/auth/logout', {}));
  const expired = h.client(); expired.cookie = oldCookie; expired.csrf = oldCsrf;
  assert.equal((await expired.send(profilePath)).status, 401);
  assert.equal((await expired.post(profilePath, { ...first, expectedVersion: 2 })).status, 401);
});

test('explicit delivery lookup uses authenticated Nigerian input, does not save addresses, and preserves native isolation', async (t) => {
  const calls = [];
  const { h, customer } = await fixture(t, { resolveDeliveryLocation: async (point) => {
    calls.push(point); return { point, line: 'Fictional nearby street suggestion', areaId: 'wuse-ii', attribution: 'Synthetic map fixture' };
  }, deliveryMapSettings: () => ({ tiles: null, attribution: '' }) });
  assert.equal((await h.client().post(lookupPath, address.point)).status, 401);
  assert.equal((await customer.send(lookupPath, { method: 'POST', data: address.point, headers: { 'X-CSRF-Token': 'forged' } })).status, 403);
  for (const point of [{ lat: 41.8781, lng: -87.6298 }, { lat: '9.08', lng: 7.4 }, { ...address.point, userId: customer.user.id }]) {
    assert.equal((await customer.post(lookupPath, point)).status, 400);
  }
  assert.equal(calls.length, 0, 'Rejected requests must not send location to the provider.');
  const location = must(await customer.post(lookupPath, address.point)).deliveryLocation;
  assert.deepEqual(location.point, address.point); assert.equal(location.line, 'Fictional nearby street suggestion');
  assert.equal(must(await customer.send(profilePath)).deliveryProfile.version, 0, 'Lookup must not silently save Home or Work.');
  const native = await phone(h, customer);
  assert.deepEqual(must(await native.send('/delivery-location', address.point)).deliveryLocation.point, address.point);
  h.advance(10 * 60_000 + 1);
  assert.equal((await native.send('/delivery-location', address.point)).status, 401);
  assert.equal(calls.length, 2, 'Expired native sessions must not invoke reverse lookup.');
});

test('delivery lookup rechecks the browser session after provider I/O before returning precise coordinates', async (t) => {
  const entered = deferred(), release = deferred();
  const { h, customer } = await fixture(t, { resolveDeliveryLocation: async (point) => {
    entered.resolve(); await release.promise;
    return { point, line: 'Private delayed lookup result', areaId: 'wuse-ii', attribution: 'Synthetic map fixture' };
  } });
  const pending = customer.post(lookupPath, address.point);
  await entered.promise;
  try { must(await customer.post('/api/auth/logout', {})); }
  finally { release.resolve(); }
  const result = await pending;
  assert.equal(result.status, 401); assert.equal(result.body.deliveryLocation, undefined);
  assert.equal(JSON.stringify(result.body).includes('Private delayed lookup result'), false);
});

test('administrator privilege does not grant access to another account’s delivery profile or location lookup', async (t) => {
  const { h, customer, other } = await fixture(t);
  must(await customer.post(profilePath, { expectedVersion: 0, label: 'home', address }));
  await bootstrapAdmin(h.db, other.user.email);
  must(await other.post('/api/auth/login', { email: other.user.email, password: PASSWORD }));
  for (const response of [await other.send(profilePath), await other.post(profilePath, { expectedVersion: 0, label: 'home', address }), await other.post(lookupPath, address.point)]) {
    assert.equal(response.status, 403); assert.equal(response.body.deliveryProfile, undefined); assert.equal(response.body.deliveryLocation, undefined);
  }
  assert.deepEqual(must(await customer.send(profilePath)).deliveryProfile.addresses.home, address);
});

test('delivery lookup does not return a late result to a native device revoked during provider I/O', async (t) => {
  const entered = deferred(), release = deferred();
  const { h, customer } = await fixture(t, { resolveDeliveryLocation: async (point) => {
    entered.resolve(); await release.promise;
    return { point, line: 'Private revoked phone lookup', areaId: 'wuse-ii', attribution: 'Synthetic map fixture' };
  } });
  const native = await phone(h, customer), pending = native.send('/delivery-location', address.point);
  await entered.promise;
  try { must(await customer.post(`/api/account/devices/${native.sessionId}/revoke`, {})); }
  finally { release.resolve(); }
  const result = await pending;
  assert.equal(result.status, 401); assert.equal(result.body.deliveryLocation, undefined);
  assert.equal(JSON.stringify(result.body).includes('Private revoked phone lookup'), false);
});
