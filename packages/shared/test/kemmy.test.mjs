import test from 'node:test';
import assert from 'node:assert/strict';
import { kemmyUpdate } from '../src/kemmy.mjs';

const ride = { status: 'on_way', service: 'ride', destination: { name: 'Maitama' },
  driver: { name: 'James Okon', vehicle: { make: 'Toyota', model: 'Camry', colour: 'Black' } },
  route: { pickup: { lat: 9.08, lng: 7.4 }, durationSeconds: 2400 }, trip: { startedAt: 1_000_000 } };

test('Kemmy uses actual vehicle fields and only recent GPS for pickup ETA', () => {
  const noFix = kemmyUpdate(ride);
  assert.match(noFix.message, /James.*Black Toyota Camry/);
  assert.equal(noFix.pickupMinutes, null);
  const withFix = kemmyUpdate(ride, { position: { lat: 9.08, lng: 7.4 }, stale: false });
  assert.equal(withFix.pickupMinutes, 1);
  assert.match(withFix.message, /about 1 min/);
});

test('arrival and in-trip minutes come from the saved road route, then completion asks for a rating', () => {
  assert.match(kemmyUpdate({ ...ride, status: 'arrived' }).message, /approximately 40 min/);
  const moving = kemmyUpdate({ ...ride, status: 'in_progress' }, { now: 1_600_000 });
  assert.equal(moving.tripMinutes, 30);
  assert.match(moving.message, /approximately 30 min/);
  assert.match(kemmyUpdate({ ...ride, status: 'completed', rating: null }).message, /rate James/);
  assert.equal(kemmyUpdate({ ...ride, status: 'completed', rating: 5 }).message.includes('5 out of 5'), true);
  assert.equal(kemmyUpdate({ ...ride, delivery: {} }), null);
});
