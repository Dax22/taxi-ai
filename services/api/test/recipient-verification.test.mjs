import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness } from './helpers.mjs';

async function fixture(t) {
  const h = await harness(t), sender = h.client(), recipient = h.client(), stranger = h.client();
  await sender.register('binding-sender'); await recipient.register('binding-recipient'); await stranger.register('binding-stranger');
  const verify = actor => h.db.prepare('INSERT OR IGNORE INTO account_email_verifications VALUES (?,?,?)').run(actor.user.id, actor.user.email, h.now);
  verify(stranger);
  const result = await sender.post('/api/rides', { pickupId: 'wuse-ii', destinationId: 'maitama', vehicleCategory: 'standard',
    delivery: { description: 'Sealed test parcel', weightKg: 1, recipientName: 'Intended recipient' } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const ride = result.body.ride;
  const invite = async (email = recipient.user.email, key = randomUUID()) => sender.post(`/api/parcels/${ride.id}/link`,
    { expectedLinkId: null, recipientEmail: email }, key);
  return { h, sender, recipient, stranger, verify, ride, invite };
}

test('an invitation requires both the intended email and verified mailbox ownership', async t => {
  const f = await fixture(t), made = await f.invite(f.recipient.user.email.toUpperCase());
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal((await f.recipient.post('/api/parcels/accept', { token: made.body.token })).status, 403);
  assert.equal((await f.stranger.post('/api/parcels/accept', { token: made.body.token })).status, 404);
  f.verify(f.recipient);
  const accepted = await f.recipient.post('/api/parcels/accept', { token: made.body.token });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const row = f.h.db.prepare('SELECT * FROM parcel_tracking_links').get();
  assert.match(row.intended_email_hash, /^[a-f0-9]{64}$/);
  assert.equal(row.recipient_verified_at, f.h.now);
  assert.equal(JSON.stringify(row).includes(f.recipient.user.email), false);
  assert.equal(JSON.stringify(accepted.body).includes('intendedEmailHash'), false);
});

test('anonymous preview reveals coarse status only and cannot claim or expose a parcel', async t => {
  const f = await fixture(t), made = await f.invite(), anonymous = f.h.client();
  const result = await anonymous.post('/api/parcels/preview', { token: made.body.token });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(Object.keys(result.body.preview).sort(), ['reference', 'requiresVerifiedAccount', 'status', 'updatedAt']);
  for (const text of [f.sender.user.email, f.ride.pickup.name, f.ride.destination.name, 'dropoffPin', 'location', 'driver', 'recipientName'])
    assert.equal(JSON.stringify(result.body.preview).includes(text), false);
  assert.equal((await anonymous.post('/api/parcels/accept', { token: made.body.token })).status, 401);
  assert.equal((await anonymous.post('/api/parcels/preview', { token: 'f'.repeat(64) })).status, 404);
});

test('binding verification is rechecked on every detailed read', async t => {
  const f = await fixture(t); f.verify(f.recipient); const made = await f.invite();
  assert.equal((await f.recipient.post('/api/parcels/accept', { token: made.body.token })).status, 200);
  f.h.db.prepare('DELETE FROM account_email_verifications WHERE user_id=?').run(f.recipient.user.id);
  assert.equal((await f.recipient.send(`/api/parcels/received/${f.ride.id}`)).status, 404);
  assert.deepEqual((await f.recipient.send('/api/parcels/received')).body.parcels, []);
});

test('unbound legacy invitations cannot grant precise tracking to a new or existing claimant', async t => {
  const f = await fixture(t); f.verify(f.recipient); const made = await f.invite();
  assert.equal((await f.recipient.post('/api/parcels/accept', { token: made.body.token })).status, 200);
  f.h.db.prepare('UPDATE parcel_tracking_links SET intended_email_hash=NULL').run();
  assert.equal((await f.recipient.send(`/api/parcels/received/${f.ride.id}`)).status, 404);
  assert.deepEqual((await f.recipient.send('/api/parcels/received')).body.parcels, []);
  assert.equal((await f.sender.send(`/api/parcels/${f.ride.id}/invitation`)).body.invitation.link.active, false);
});

test('unclaimed invitations expire after 24 hours and retries never reveal the secret twice', async t => {
  const f = await fixture(t), key = randomUUID(), made = await f.invite(f.recipient.user.email, key);
  assert.equal(made.body.invitation.link.expiresAt - f.h.now, 86_400_000);
  const replay = await f.invite(f.recipient.user.email, key);
  assert.equal(replay.body.replayed, true); assert.equal(replay.body.token, undefined);
  f.h.advance(86_400_000);
  assert.equal((await f.h.client().post('/api/parcels/preview', { token: made.body.token })).status, 404);
});

test('missing intended recipient is rejected rather than silently issuing a bearer-only invitation', async t => {
  const f = await fixture(t);
  const result = await f.sender.post(`/api/parcels/${f.ride.id}/link`, { expectedLinkId: null });
  assert.equal(result.status, 400);
  assert.equal(result.body.error.code, 'INVALID_CLIENT_VERSION');
  assert.match(result.body.error.message, /Update the Taxi Ai app/);
  assert.equal(f.h.db.prepare('SELECT count(*) AS n FROM parcel_tracking_links').get().n, 0);
});
