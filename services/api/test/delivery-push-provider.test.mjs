import test from 'node:test';
import assert from 'node:assert/strict';
import { createPushProvider } from '../src/infrastructure/push-provider.mjs';

const id = '00000000-0000-4000-8000-000000000001';
const token = 'ExpoPushToken[fixture_no_real_destination]';

test('Kemmy delivery push shows the saved message and opens only an authenticated update ID', async () => {
  const calls = [];
  const provider = createPushProvider({ env: { TAXI_AI_PUSH_ENABLED: 'true', TAXI_AI_EXPO_PROJECT_ID: id },
    fetchImpl: async (url, options) => {
      calls.push({ url, payload: JSON.parse(options.body), options });
      return Response.json({ data: { status: 'ok', id: 'delivery-ticket' } });
    } });
  const input = { token, deliveryUpdateId: id, deliveryTitle: 'Kemmy · Food picked up',
    deliveryBody: 'Your food has been picked up. It should be delivered in approximately 18 minutes, based on the map route.' };
  assert.deepEqual(await provider.send(input), { status: 'ticket', ticket: 'delivery-ticket' });
  assert.equal(calls[0].url, 'https://exp.host/--/api/v2/push/send');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].payload.title, 'Kemmy · Food picked up');
  assert.equal(calls[0].payload.body, input.deliveryBody);
  assert.deepEqual(calls[0].payload.data, { kind: 'delivery', deliveryUpdateId: id });
  assert.equal(calls[0].payload.ttl, 300);
  assert.equal(calls[0].payload.channelId, 'deliveries');
  for (const invalid of [{ deliveryUpdateId: 'https://untrusted.example' }, { notificationId: 1 },
    { familyEventId: id }, { announcementId: id }, { deliveryBody: 'x'.repeat(1001) }, { deliveryTitle: '' }]) {
    assert.deepEqual(await provider.send({ ...input, ...invalid }), { status: 'error' });
  }
  assert.equal(calls.length, 1, 'Malformed or conflicting notifications never reach the provider.');
});

test('delivery notifications do not contact Expo before push is enabled', async () => {
  const provider = createPushProvider({ fetchImpl: () => assert.fail('No provider call expected') });
  assert.deepEqual(await provider.send({ token, deliveryUpdateId: id,
    deliveryTitle: 'Package arrived', deliveryBody: 'Your package has arrived at the recipient’s address.' }), { status: 'error' });
});
