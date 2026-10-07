import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../../../services/api/test/helpers.mjs';

test('delivery-record page and its complete module dependencies are explicitly served', async t => {
  const h = await harness(t);
  for (const path of ['/parcel-operations', '/parcel-operations.mjs', '/parcel-operations.css',
    '/shared/delivery-operations.mjs', '/shared/delivery-operations-controller.mjs']) {
    const response = await fetch(h.base + path);
    assert.equal(response.status, 200, path);
    const body = await response.text(); assert.ok(body.length > 0, path);
    if (path === '/parcel-operations') {
      for (const name of ['ops-report', 'ops-request_return', 'ops-authorize_return', 'ops-confirm_return', 'ops-retry', 'ops-refresh']) assert.ok(body.includes(`id="${name}"`), name);
      assert.match(body, /physically receives the parcel/);
      assert.match(body, /Confirmation|confirmation/);
    }
  }
  const id = '00000000-0000-4000-8000-000000000001';
  assert.equal((await h.client().send(`/api/parcels/${id}/operations`)).status, 401);
});
