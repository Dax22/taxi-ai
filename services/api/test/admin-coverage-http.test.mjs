import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, bootstrapAdmin, PASSWORD } from './helpers.mjs';
import { createStaffFactor, totpCode } from '../src/infrastructure/staff-factor.mjs';

const consolePath = '/api/admin/console';
const coveragePath = consolePath + '/demand/coverage';
const must = (response, status = 200) => {
  assert.equal(response.status, status, JSON.stringify(response.body));
  return response.body;
};
const login = actor => actor.post(consolePath + '/login', { email: actor.user.email, password: PASSWORD });

async function fixture(t, roles = ['operations']) {
  const h = await harness(t), actors = await participants(h), result = { h, ...actors };
  for (const role of roles) {
    const actor = h.client(); await actor.register('coverage-' + role);
    must(await result.admin.post(consolePath + '/staff/assign', {
      email: actor.user.email, role, expectedVersion: 0, reason: 'Fictional coverage reporting assignment.',
    }));
    must(await login(actor)); result[role] = actor;
  }
  return result;
}

function seedRequest(f, { createdAt = f.h.now - 60_000, expiresAt = f.h.now + 60_000,
  pickup = { lat: 9.076541, lng: 7.462321 }, region = 'ng:181:149', category = 'standard',
  status = 'requested', driverId = null, bookedAt = null, arrivedAt = null } = {}) {
  const customerId = randomUUID(), id = randomUUID(), quoteId = randomUUID();
  f.h.db.prepare(`INSERT INTO users(id,email,name,password_hash,role,created_at)
    VALUES (?,?,?,'non-login-fixture','customer',?)`)
    .run(customerId, customerId + '@private.example.test', 'Private coverage passenger', createdAt);
  f.h.db.prepare(`INSERT INTO rides(id,customer_id,driver_id,pickup_id,destination_id,suggested_fare_kobo,status,
    created_at,updated_at,request_expires_at,dispatch_region,vehicle_category,matched_at)
    VALUES (?,?,?,'private-home-address','private-destination',450000,?,?,?,?,?,?,?)`)
    .run(id, customerId, driverId, status, createdAt, createdAt, expiresAt, region, category, driverId ? createdAt + 10_000 : null);
  if (pickup !== null) f.h.db.prepare(`INSERT INTO location_quotes(id,customer_id,created_at,expires_at,route_json,ride_id)
    VALUES (?,?,?,?,?,?)`).run(quoteId, customerId, createdAt, expiresAt,
    JSON.stringify({ pickup: { ...pickup, label: 'Private home number 981', providerId: 'private-provider-place' },
      destination: { lat: 9.133337, lng: 7.477771, label: 'Private destination name' }, polyline: 'private-route-polyline' }), id);
  if (bookedAt !== null) f.h.db.prepare(`INSERT INTO ride_trips(ride_id,customer_id,driver_id,status,fare_kobo,booked_at,departed_at,arrived_at,started_at,completed_at)
    VALUES (?,?,?,'completed',450000,?,?,?,?,?)`)
    .run(id, customerId, driverId, bookedAt, bookedAt + 1000, arrivedAt, arrivedAt, arrivedAt + 1000);
  return { id, customerId, quoteId };
}

test('coverage HTTP access admits Owner and Operations memberships without granting customer or other staff access', async t => {
  const f = await fixture(t, ['operations', 'support', 'safety', 'finance']);
  assert.equal((await f.h.client().send(coveragePath)).status, 401);
  assert.equal((await f.customer.send(coveragePath)).status, 403);
  assert.equal((await f.driver.send(coveragePath)).status, 403);
  for (const role of ['admin', 'operations', 'support', 'safety', 'finance']) {
    const result = await f[role].send(coveragePath);
    assert.equal(result.status, ['admin', 'operations'].includes(role) ? 200 : 403, role + ': ' + JSON.stringify(result.body));
  }
  assert.equal(f.h.db.prepare('SELECT role FROM users WHERE id=?').get(f.operations.user.id).role, 'customer');
  assert.equal((await f.operations.send('/api/admin/drivers')).status, 403);
  assert.equal((await f.operations.send(coveragePath, { headers: { Origin: 'https://untrusted.test' } })).status, 403);
  assert.equal((await f.operations.post(coveragePath, {})).status, 404, 'Coverage is read-only.');
  for (const suffix of ['/private', '/export', '/drivers']) {
    assert.equal((await f.operations.send(coveragePath + suffix)).status, 404, 'Only the exact aggregate route is exposed.');
  }
  const native = await fetch(f.h.base + '/api/mobile/v1/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.operations.user.email,
      password: PASSWORD, deviceName: 'Fictional coverage isolation phone' }) });
  assert.equal(native.status, 200);
  const { credentials } = await native.json();
  assert.equal((await f.h.client().send(coveragePath, { headers: { Authorization: 'Bearer ' + credentials.accessToken } })).status, 401);
});

test('coverage HTTP route rejects repeated, unsupported and unbounded filters before returning any data', async t => {
  const f = await fixture(t);
  for (const query of [
    'from=2026-01-01&from=2025-12-31', 'service=ride&service=courier', 'bbox=7,9,8,10&bbox=3,6,4,7',
    'place=nigeria&place=abuja', 'layer=demand&layer=coverage', 'from=2026-02-30',
    'from=2025-01-01&to=2026-01-01', 'from=2026-01-02&to=2026-01-01', 'to=2026-01-02',
    'service=eats', 'place=private-home-address', 'layer=drivers-private', 'limit=100000',
    'bbox=7,9,8', 'bbox=8,9,7,10', 'bbox=7,10,8,9', 'bbox=NaN,9,8,10', 'bbox=-180,-90,180,90',
    'bbox=7,9,7,10', 'bbox=7,9,8,10,11', 'customerId=' + f.customer.user.id,
  ]) {
    const result = await f.operations.send(coveragePath + '?' + query);
    assert.equal(result.status, 400, query + ': ' + JSON.stringify(result.body));
    assert.ok(!Object.hasOwn(result.body, 'cells'), query);
  }
});

test('coverage rechecks staff revocation and does not rely on an earlier successful report', async t => {
  const f = await fixture(t);
  must(await f.operations.send(coveragePath));
  const membership = f.h.db.prepare('SELECT version FROM staff_memberships WHERE user_id=?').get(f.operations.user.id);
  must(await f.admin.post(consolePath + '/staff/revoke', { userId: f.operations.user.id,
    expectedVersion: membership.version, reason: 'Fictional coverage reporting assignment ended.' }));
  assert.ok([401, 403].includes((await f.operations.send(coveragePath)).status));
  must(await f.operations.post('/api/auth/login', { email: f.operations.user.email, password: PASSWORD }));
  assert.equal((await f.operations.send(coveragePath)).status, 403);
});

test('coverage requires enrolled MFA and a current verified browser session when configured', async t => {
  const factor = createStaffFactor({ key: '2b'.repeat(32), required: true });
  const h = await harness(t, { staffMfa: { required: true, factor } });
  const admin = h.client(); await admin.register('coverage-mfa-owner'); await bootstrapAdmin(h.db, admin.user.email);
  must(await login(admin));
  let blocked = await admin.send(coveragePath);
  assert.equal(blocked.status, 403); assert.equal(blocked.body.error.code, 'MFA_SETUP_REQUIRED');
  const { setup } = must(await admin.post(consolePath + '/staff/mfa/enroll', { password: PASSWORD }));
  must(await admin.post(consolePath + '/staff/mfa/confirm', { code: totpCode(setup.secret, h.now) }));
  must(await admin.send(coveragePath));
  const another = h.client(); another.user = admin.user; must(await login(another));
  blocked = await another.send(coveragePath);
  assert.equal(blocked.status, 403); assert.equal(blocked.body.error.code, 'MFA_REQUIRED');
  h.advance(15 * 60_000);
  blocked = await admin.send(coveragePath);
  assert.equal(blocked.status, 403); assert.equal(blocked.body.error.code, 'MFA_REQUIRED');
});

test('coverage separates dated pickup demand, live waiting and supply, and only returns coarse anonymous map cells', async t => {
  const f = await fixture(t);
  await f.driver.online({ mode: 'gps', lat: 9.076541, lng: 7.462321 });
  const rides = [
    seedRequest(f),
    seedRequest(f, { createdAt: f.h.now - 2 * 86400000 }),
    seedRequest(f, { expiresAt: f.h.now - 1 }),
    seedRequest(f, { pickup: { lat: 6.456789, lng: 3.356789 }, region: 'ng:129:67' }),
    seedRequest(f, { pickup: null, region: 'sample:wuse-ii' }),
    seedRequest(f, { pickup: null, region: 'Private legacy address' }),
  ];
  const body = must(await f.operations.send(coveragePath + '?from=2026-01-01&to=2026-01-01&bbox=7.42,9.04,7.50,9.11'));
  assert.equal(body.historicalTotals.requests, 2);
  assert.equal(body.historicalTotals.unserved, 1);
  assert.equal(body.historicalTotals.pickupWaitObservations, 0);
  assert.equal(body.historicalTotals.meanPickupWaitSeconds, null);
  assert.equal(body.currentTotals.waitingRequests, 2, 'A currently waiting old request remains in the live layer.');
  assert.equal(body.currentTotals.availableDrivers, 1);
  assert.equal(body.outsideViewport.historical.requests, 1);
  assert.equal(body.outsideViewport.current.waitingRequests, 1);
  assert.equal(body.offMap.scope, 'nationwide');
  assert.equal(body.offMap.historical.sample.requests, 1);
  assert.equal(body.offMap.historical.unlocated.requests, 1);
  assert.equal(body.nationwideTotals.historical.requests, 5);
  assert.equal(body.nationwideTotals.current.waitingRequests, 5);
  assert.equal(body.cells.reduce((sum, cell) => sum + cell.requests, 0), body.historicalTotals.requests);
  assert.equal(body.cells.reduce((sum, cell) => sum + cell.waitingRequests, 0), body.currentTotals.waitingRequests);
  assert.equal(body.cells.reduce((sum, cell) => sum + cell.availableDrivers, 0), body.currentTotals.availableDrivers);
  const serialized = JSON.stringify(body);
  for (const value of [f.customer.user.id, f.driver.user.id, f.customer.user.email, f.driver.user.email,
    ...rides.flatMap(ride => [ride.id, ride.customerId, ride.quoteId]),
    '9.076541', '7.462321', '6.456789', '3.356789', '9.133337', '7.477771',
    'Private coverage passenger', 'Private home number 981', 'Private destination name', 'private-provider-place',
    'private-route-polyline', 'Private legacy address', 'private-home-address', 'position_json', 'route_json', 'pickupPin', 'password_hash']) {
    assert.ok(!serialized.includes(value), value);
  }
  const courier = must(await f.operations.send(coveragePath + '?service=courier&bbox=7.42,9.04,7.50,9.11'));
  assert.equal(courier.historicalTotals.requests, 0); assert.equal(courier.currentTotals.waitingRequests, 0);
  assert.equal(courier.currentTotals.availableDrivers, 0);
  const lagos = must(await f.operations.send(coveragePath + '?from=2026-01-01&to=2026-01-01&place=map-lagos'));
  assert.equal(lagos.historicalTotals.requests, 1); assert.equal(lagos.currentTotals.waitingRequests, 1);
  assert.equal(lagos.currentTotals.availableDrivers, 0);
  const wuse = must(await f.operations.send(coveragePath + '?from=2026-01-01&to=2026-01-01&place=map-wuse'));
  const maitama = must(await f.operations.send(coveragePath + '?from=2026-01-01&to=2026-01-01&place=map-maitama'));
  assert.equal(wuse.historicalTotals.requests, 2); assert.equal(maitama.historicalTotals.requests, 0);
  assert.equal(maitama.offMap.historical.sample.requests, 1, 'Sample area labels cannot become live neighbourhood locations.');
  assert.equal(f.h.db.prepare('SELECT status FROM rides WHERE id=?').get(rides[2].id).status, 'requested', 'Reporting must not mutate expired requests.');
});

test('coverage snaps sub-cell viewport probes before counting so they cannot reveal a passenger or driver position', async t => {
  const f = await fixture(t);
  await f.driver.online({ mode: 'gps', lat: 9.076541, lng: 7.462321 });
  seedRequest(f);
  // One rectangle encloses the saved position and one does not. Both belong to
  // the same coarse cell and must receive the exact same aggregate report.
  const enclosing = must(await f.operations.send(coveragePath + '?bbox=7.462320,9.076540,7.462322,9.076542'));
  const displaced = must(await f.operations.send(coveragePath + '?bbox=7.468001,9.078001,7.468002,9.078002'));
  assert.deepEqual(enclosing, displaced);
  assert.equal(enclosing.historicalTotals.requests, 1);
  assert.equal(enclosing.currentTotals.availableDrivers, 1);
  const bounds = enclosing.viewport.bounds;
  assert.ok(bounds.east - bounds.west >= 0.01 - 1e-9);
  assert.ok(bounds.north - bounds.south >= 0.01 - 1e-9);
  assert.equal(enclosing.cells.reduce((sum, cell) => sum + cell.requests, 0), enclosing.historicalTotals.requests);
  assert.equal(enclosing.outsideViewport.historical.requests, 0);
});

test('coverage pickup wait uses observed booking-to-arrival timing and exposes its denominator rather than inventing missing waits', async t => {
  const f = await fixture(t), bookedAt = f.h.now - 300_000;
  for (const seconds of [60, 180, -1, 301]) seedRequest(f, { status: 'agreed', driverId: f.driver.user.id,
    createdAt: bookedAt - 20_000, bookedAt, arrivedAt: bookedAt + seconds * 1000 });
  seedRequest(f, { status: 'agreed', driverId: f.driver.user.id, createdAt: bookedAt - 20_000 });
  const body = must(await f.operations.send(coveragePath + '?place=map-wuse&layer=wait&from=2026-01-01&to=2026-01-01'));
  assert.equal(body.historicalTotals.requests, 5);
  assert.equal(body.historicalTotals.pickupWaitObservations, 2);
  assert.equal(body.historicalTotals.meanPickupWaitSeconds, 120);
  assert.equal(body.currentTotals.waitingRequests, 0);
  assert.equal(body.cells.length, 1); assert.equal(body.cells[0].pickupWaitObservations, 2);
  assert.equal(body.cells[0].meanPickupWaitSeconds, 120);
});
