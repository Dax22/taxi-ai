import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../public/dashboard/guest-trip-controller.mjs', import.meta.url), 'utf8'))
  .replace("'/shared/guest-rides.mjs'", `'${new URL('../../../packages/shared/src/guest-rides.mjs', import.meta.url)}'`);
const { createGuestTripController } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };
const response = (extra = {}) => ({ mode: 'preview', expiresAt: 100_000,
  guestTrip: { reference: 'TAXI-1234ABCD', status: 'booked', passengerName: 'Test Guest', bookerName: 'Test Booker',
    pickup: 'Wuse', destination: 'Maitama', driver: { name: 'Driver', vehicle: { model: 'Toyota Corolla', plate: 'TEST-001', category: 'standard' } },
    pickupPin: '001234', location: null, ...extra } });
function setup() {
  let latest, now = 1000, read = async () => response();
  const requests = [];
  const viewer = createGuestTripController({ token: 'a'.repeat(64), now: () => now,
    client: { async request(path, options) { requests.push({ path, options }); return read(); } },
    view: { render(value) { latest = value; } } });
  return { viewer, requests, result: () => latest, read(fn) { read = fn; }, time(value) { now = value; } };
}

test('public capability is sent in a POST body; errors erase prior PIN and private trip details', async () => {
  const h = setup(); await h.viewer.poll();
  assert.equal(h.result().data.guestTrip.pickupPin, '001234');
  assert.equal(h.requests[0].path, '/api/guest-trip/view');
  assert.deepEqual(h.requests[0].options, { method: 'POST', data: { token: 'a'.repeat(64) } });
  h.read(async () => { throw new Error('Offline'); }); await h.viewer.poll();
  assert.equal(h.result().data, null); assert.match(h.result().message, /cleared/);
  h.read(async () => response()); await h.viewer.poll(); assert.ok(h.result().data);
});

test('backgrounding clears details and invalidates pending results; foregrounding rechecks the capability', async () => {
  const h = setup(); await h.viewer.poll();
  const wait = deferred(); h.read(() => wait.promise); const pending = h.viewer.poll();
  h.viewer.suspend(); assert.equal(h.result().data, null);
  wait.resolve(response()); await pending; assert.equal(h.result().data, null);
  const count = h.requests.length; await h.viewer.poll(); assert.equal(h.requests.length, count);
  h.read(async () => response()); await h.viewer.resume(); assert.ok(h.result().data);
});

test('expiry and revoked responses remove token access permanently; closed viewers discard late results', async () => {
  const h = setup(); await h.viewer.poll(); h.time(100_000); h.viewer.tick();
  assert.equal(h.result().data, null); const count = h.requests.length;
  await h.viewer.poll(); assert.equal(h.requests.length, count);
  const denied = setup(); denied.read(async () => { throw Object.assign(new Error('Revoked'), { status: 404 }); });
  await denied.viewer.poll(); denied.read(async () => response()); await denied.viewer.poll(); assert.equal(denied.requests.length, 1);
  const closing = setup(), wait = deferred(); closing.read(() => wait.promise); const pending = closing.viewer.poll();
  closing.viewer.close(); wait.resolve(response()); await pending; assert.equal(closing.result().data, null);
});

test('unexpected private fields and a PIN after trip start fail closed', async () => {
  for (const extra of [{ phone: '+2348012345678' }, { status: 'in_progress', pickupPin: '001234' }]) {
    const h = setup(); h.read(async () => response(extra)); await h.viewer.poll(); assert.equal(h.result().data, null);
  }
  const h = setup(); h.read(async () => response({ status: 'in_progress', pickupPin: null })); await h.viewer.poll();
  assert.equal(h.result().data.guestTrip.pickupPin, null);
});
