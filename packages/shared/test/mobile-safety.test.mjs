import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSafetyContacts, parseTripSafety, parseSafetyMutation, safetyCommandPath, safetyLocationLabel } from '../src/mobile-safety.mjs';
const id = '11111111-1111-4111-8111-111111111111', rideId = '22222222-2222-4222-8222-222222222222';
const base = { mode: 'simulation', viewerId: id, serverNow: 1000 };
const contact = { id, name: 'Test friend', phone: '+2348000000000', version: 0, verified: false };
const share = { id, rideId, active: true, version: 0, createdAt: 1000, expiresAt: 901000 };
const incident = { id, rideId, kind: 'need_help', status: 'open', version: 0, note: 'Test only', createdAt: 1000, updatedAt: 1000,
  driverName: 'Test driver', vehiclePlate: 'TEST-DRIVER', location: null, notifications: [], events: [{ action: 'created', note: '', createdAt: 1000 }] };
test('native safety parsers preserve narrow projections and reject incompatible modes, contact data and trip identity', () => {
  assert.deepEqual(parseSafetyContacts({ ...base, contacts: [{ ...contact, accessToken: 'secret' }], settings: {} }), { ...base, contacts: [contact] });
  const trip = { ...base, rideId, canRaise: true, share, incidents: [incident], location: null };
  assert.deepEqual(parseTripSafety({ ...trip, token: 'secret', incidents: [{ ...incident, reporterId: id, snapshot: { private: true } }] }), trip);
  for (const contacts of [[{ ...contact, verified: true }], [contact, contact], [{ ...contact, phone: '08000000000' }]]) assert.throws(() => parseSafetyContacts({ ...base, contacts }));
  assert.throws(() => parseSafetyContacts({ ...base, mode: 'live', contacts: [] }));
  assert.throws(() => parseTripSafety({ ...trip, share: { ...share, rideId: id } }));
  assert.throws(() => parseTripSafety({ ...trip, incidents: [{ ...incident, rideId: id }] }));
  assert.throws(() => parseTripSafety({ ...trip, incidents: [{ ...incident, notifications: [{ id, recipientName: 'Test', recipientPhone: contact.phone, mode: 'simulation', status: 'sent', attempts: 1, updatedAt: 1000 }] }] }));
});
test('link secrets only appear on a non-replayed creation and commands cannot select arbitrary endpoints', () => {
  const reply = { ...base, replayed: false, share, token: 'a'.repeat(64) };
  assert.deepEqual(parseSafetyMutation(reply), reply);
  assert.equal(parseSafetyMutation({ ...reply, replayed: true, token: null }).token, null);
  for (const extra of [{ replayed: true }, { token: 'bad' }, { share: { ...share, active: false } }, { contact }]) assert.throws(() => parseSafetyMutation({ ...reply, ...extra }));
  assert.equal(safetyCommandPath({ action: 'link.revoke', id, data: { expectedVersion: 0 } }), `/safety/links/${id}/revoke`);
  assert.throws(() => safetyCommandPath({ action: 'incident.review', id, data: {} }));
  assert.throws(() => safetyCommandPath({ action: 'contact.remove', id: '../admin', data: {} }));
});
test('location labels never invent GPS and age a previously recent position into stale', () => {
  assert.match(safetyLocationLabel(null, 1000), /Location unavailable/);
  const position = { lat: 9, lng: 7, accuracy: 12, capturedAt: 1000, stale: false, source: 'driver_shared' };
  assert.match(safetyLocationLabel(position, 2000), /Recent/);
  assert.match(safetyLocationLabel(position, 32000), /Stale/);
  assert.match(safetyLocationLabel({ ...position, stale: true }, 1001), /Stale/);
});
