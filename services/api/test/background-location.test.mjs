import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { harness, participants, requestRide, claimRide, PASSWORD } from './helpers.mjs';
import { saveSnapshot } from '../src/infrastructure/database-snapshot.mjs';

const base = '/tracking/background';
const digest = token => createHash('sha256').update(token).digest('hex');
const ok = result => { assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body; };
async function send(h, path, token, data, headers = {}) {
  const response = await fetch(`${h.base}/api/mobile/v1${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  return { status: response.status, body: await response.json() };
}
const login = async (h, actor) => ok(await send(h, '/auth/login', null, {
  email: actor.user.email, password: PASSWORD, deviceName: 'Background GPS fixture',
})).credentials;
const step = async (actor, ride, action, extra = {}) => ok(await actor.post(`/api/rides/${ride.id}/${action}`,
  { expectedVersion: ride.version, ...extra })).ride;
async function fixture(t, { fixed = true, persistent = false } = {}) {
  const h = await harness(t, { persistent }), actors = await participants(h);
  let ride = await claimRide(actors.driver, await requestRide(actors.customer));
  ride = await step(actors.driver, ride, 'offers', { amountKobo: 470000 });
  ride = await step(actors.customer, ride, 'accept', { offerId: ride.negotiation.currentOffer.id });
  ride = await step(actors.customer, ride, 'confirm');
  const credentials = await login(h, actors.driver), clientId = randomUUID();
  const share = ok(await send(h, `/tracking/rides/${ride.id}/start?clientId=${clientId}`, credentials.accessToken, {})).share;
  const data = { kind: 'ride', jobId: ride.id, shareId: share.id, clientId };
  const point = (sequence = 2, changes = {}) => ({ sequence, lat: 9.08, lng: 7.4, accuracy: 10, capturedAt: h.now, ...changes });
  if (fixed) ok(await send(h, `/tracking/shares/${share.id}/position?clientId=${clientId}`, credentials.accessToken, point(1)));
  return { h, ...actors, ride, credentials, clientId, share, data, point,
    issue: async (body = data, token = credentials.accessToken) => send(h, `${base}/start`, token, body),
    fix: (sequence = 1) => send(h, `/tracking/shares/${share.id}/position?clientId=${clientId}`, credentials.accessToken, point(sequence)),
  };
}
const rejected = (result, code) => {
  assert.equal(result.status, code === 'UNAUTHENTICATED' ? 401 : 409, JSON.stringify(result.body));
  assert.equal(result.body.error.code, code);
};

test('background credentials require an owned native lease and fresh GPS, remain job-scoped, and are stored only as hashes', async t => {
  const f = await fixture(t, { fixed: false });
  rejected(await f.issue(), 'LOCATION_REQUIRED');
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM background_location_tokens').get().n, 0);
  ok(await f.fix());
  for (const change of [{ clientId: randomUUID() }, { shareId: randomUUID() }]) rejected(await f.issue({ ...f.data, ...change }), 'LOCATION_CLOSED');
  for (const change of [{ kind: 'food' }, { jobId: randomUUID() }]) assert.equal((await f.issue({ ...f.data, ...change })).status, 404);
  const customerPhone = await login(f.h, f.customer), otherPhone = await login(f.h, f.driver);
  rejected(await f.issue(f.data, customerPhone.accessToken), 'LOCATION_CLOSED');
  rejected(await f.issue(f.data, otherPhone.accessToken), 'LOCATION_CLOSED');
  assert.equal((await f.issue({ ...f.data, driverId: f.driver.user.id })).status, 400);
  const { background } = ok(await f.issue()), rows = f.h.db.prepare('SELECT * FROM background_location_tokens').all();
  assert.equal(rows.length, 1); assert.equal(rows[0].token_hash, digest(background.token));
  assert.equal(background.expiresAt, f.h.now + 12 * 60 * 60_000); assert.equal(background.sequence, 1);
  assert.equal(JSON.stringify(rows).includes(background.token), false);
  assert.equal(JSON.stringify(f.h.db.prepare('SELECT * FROM audit_events').all()).includes(background.token), false);
  for (const [path, data] of [['/session'], [`/tracking/rides/${f.ride.id}`], [`/tracking/rides/${f.ride.id}/start?clientId=${f.clientId}`, {}],
    [`${base}/start`, f.data], ['/booking/requests', { pickupId: 'wuse-ii', destinationId: 'maitama' }]]) {
    assert.equal((await send(f.h, path, background.token, data)).status, 401, path);
  }
  assert.equal((await send(f.h, `${base}/position`, f.credentials.accessToken, f.point())).status, 401);
  assert.equal((await send(f.h, `${base}/position`, background.token)).status, 405);
  assert.equal((await send(f.h, `${base}/position?jobId=${randomUUID()}`, background.token, f.point())).status, 400);
  assert.equal((await send(f.h, `${base}/position`, background.token, { ...f.point(), jobId: randomUUID() })).status, 400);
  assert.equal((await send(f.h, `${base}/position`, background.token, f.point(), { Origin: f.h.base })).status, 403);
  assert.equal((await send(f.h, `${base}/position`, background.token, f.point(), { 'Sec-Fetch-Site': 'same-origin' })).status, 403);
  assert.equal(ok(await send(f.h, `${base}/position`, background.token, f.point())).share.sequence, 2);
});

test('background publication survives access-token expiry without renewing the account and rejects stale or malformed GPS', async t => {
  const f = await fixture(t), { background } = ok(await f.issue());
  f.h.db.prepare('UPDATE device_sessions SET access_expires_at=? WHERE id=?').run(f.h.now, f.credentials.sessionId);
  const before = f.h.db.prepare('SELECT * FROM device_sessions WHERE id=?').get(f.credentials.sessionId);
  assert.equal((await send(f.h, '/session', f.credentials.accessToken)).status, 401);
  assert.equal(ok(await send(f.h, `${base}/position`, background.token, f.point())).share.sequence, 2);
  assert.deepEqual(f.h.db.prepare('SELECT * FROM device_sessions WHERE id=?').get(f.credentials.sessionId), before);
  for (const changes of [{ capturedAt: f.h.now - 30_000 }, { capturedAt: f.h.now + 5001 }, { accuracy: 201 }, { lat: 41.8781, lng: -87.6298 }, { lat: '9.08' }]) {
    const result = await send(f.h, `${base}/position`, background.token, f.point(3, changes));
    assert.equal(result.status, 400, JSON.stringify(result.body)); assert.equal(result.body.error.code, 'INVALID_LOCATION');
  }
  assert.equal(f.h.db.prepare('SELECT sequence FROM location_shares WHERE id=?').get(f.share.id).sequence, 2);
  ok(await send(f.h, `${base}/stop`, background.token, {}));
  rejected(await send(f.h, `${base}/position`, background.token, f.point(3)), 'UNAUTHENTICATED');
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM background_location_tokens').get().n, 0);
});

test('credential rotation invalidates the old grant, cannot move its job, and caps validity at twelve hours', async t => {
  const f = await fixture(t), first = ok(await f.issue()).background, next = ok(await f.issue()).background;
  assert.notEqual(first.token, next.token);
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM background_location_tokens').get().n, 1);
  rejected(await send(f.h, `${base}/position`, first.token, f.point()), 'UNAUTHENTICATED');
  rejected(await send(f.h, `${base}/stop`, first.token, {}), 'UNAUTHENTICATED');
  ok(await send(f.h, `${base}/position`, next.token, f.point()));
  const row = f.h.db.prepare('SELECT * FROM background_location_tokens').get();
  assert.equal(row.job_id, f.ride.id); assert.equal(row.share_id, f.share.id); assert.equal(row.client_id, f.clientId);
  f.h.advance(12 * 60 * 60_000);
  rejected(await send(f.h, `${base}/position`, next.token, f.point(3)), 'UNAUTHENTICATED');
});

test('device-family revocation and native logout immediately invalidate scoped background credentials', async t => {
  for (const action of ['revoke', 'logout']) {
    const f = await fixture(t), { background } = ok(await f.issue());
    if (action === 'revoke') ok(await f.driver.post(`/api/account/devices/${f.credentials.sessionId}/revoke`, {}));
    else ok(await send(f.h, '/auth/logout', null, { refreshToken: f.credentials.refreshToken }));
    assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM background_location_tokens').get().n, 0);
    rejected(await send(f.h, `${base}/position`, background.token, f.point()), 'UNAUTHENTICATED');
    rejected(await send(f.h, `${base}/stop`, background.token, {}), 'UNAUTHENTICATED');
  }
});

test('completion, explicit sharing stop and an expired lease prevent background coordinates from reviving tracking', async t => {
  for (const end of ['complete', 'stop', 'expire']) {
    const f = await fixture(t), { background } = ok(await f.issue());
    if (end === 'complete') {
      let ride = await step(f.driver, f.ride, 'depart');
      ride = await step(f.driver, ride, 'arrive');
      ride = await step(f.driver, ride, 'start', { pickupPin: f.ride.trip.pickupPin });
      await step(f.driver, ride, 'complete');
    } else if (end === 'stop') {
      ok(await send(f.h, `/tracking/shares/${f.share.id}/stop?clientId=${f.clientId}`, f.credentials.accessToken, {}));
    } else f.h.advance(60_000);
    rejected(await send(f.h, `${base}/position`, background.token, f.point()), 'LOCATION_CLOSED');
    assert.equal(ok(await f.customer.send(`/api/rides/${f.ride.id}/location`)).share, null);
    const row = f.h.db.prepare('SELECT * FROM location_shares WHERE id=?').get(f.share.id);
    assert.equal(row.active, 0); assert.equal(row.position_json, null);
  }
});

test('approval loss blocks publication while the owner can still stop background tracking', async t => {
  const f = await fixture(t), { background } = ok(await f.issue());
  f.h.db.prepare("UPDATE drivers SET status='rejected' WHERE user_id=?").run(f.driver.user.id);
  assert.equal((await send(f.h, `${base}/position`, background.token, f.point())).body.error.code, 'DRIVER_NOT_APPROVED');
  ok(await send(f.h, `${base}/stop`, background.token, {}));
  assert.equal(f.h.db.prepare('SELECT position_json FROM location_shares WHERE id=?').get(f.share.id).position_json, null);
});

test('sanitized snapshots remove background tokens only from the copy and cannot retain usable GPS credentials', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'taxi-background-snapshot-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const f = await fixture(t, { persistent: true }), { background } = ok(await f.issue());
  const source = f.h.db.prepare('SELECT * FROM background_location_tokens').all(), path = join(folder, 'copy.sqlite');
  saveSnapshot(f.h.filename, path, { now: f.h.now });
  assert.deepEqual(f.h.db.prepare('SELECT * FROM background_location_tokens').all(), source);
  const copy = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(copy.prepare('SELECT count(*) AS n FROM background_location_tokens').get().n, 0);
    assert.equal(copy.prepare('SELECT count(*) AS n FROM device_sessions').get().n, 0);
    assert.equal(copy.prepare('SELECT active FROM location_shares WHERE id=?').get(f.share.id).active, 0);
    assert.deepEqual(copy.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { copy.close(); }
  const bytes = await readFile(path);
  assert.equal(bytes.includes(Buffer.from(background.token)), false);
  assert.equal(bytes.includes(Buffer.from(digest(background.token))), false);
  ok(await send(f.h, `${base}/position`, background.token, f.point()));
});
