import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeliveryPositionRequest } from '../src/eats/delivery-position-request.ts';
import type { DeliveryPoint, DeliverySuggestion } from '../src/eats/delivery-position-request.ts';

const point = { lat: 9.0765, lng: 7.3986 }, nextPoint = { lat: 6.5244, lng: 3.3792 };
const suggestion = (selected = point): DeliverySuggestion => ({ point: selected, line: '10 Example Street', areaId: null, attribution: 'Map provider' });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

test('delivery location requests never collect GPS on setup or for someone else', async () => {
  let captures = 0, lookups = 0;
  const flow = createDeliveryPositionRequest({ currentPosition: async () => { captures++; return point; }, locate: async () => { lookups++; return suggestion(); }, busy() {}, error() {}, result() {} });
  assert.equal(captures, 0);
  assert.equal(await flow.current('other'), false);
  assert.equal(captures, 0); assert.equal(lookups, 0);
  assert.equal(await flow.current('self'), true);
  assert.equal(captures, 1); assert.equal(lookups, 1);
});

test('manual edits or recipient changes cancel an outstanding fix before any reverse lookup', async () => {
  const fix = deferred<DeliveryPoint>(); let signal!: AbortSignal, lookups = 0; const values: DeliverySuggestion[] = [];
  const flow = createDeliveryPositionRequest({ currentPosition: (current) => { signal = current!; return fix.promise; }, locate: async () => { lookups++; return suggestion(); }, busy() {}, error() {}, result: (value) => values.push(value) });
  const pending = flow.current('self'); flow.cancel();
  assert.equal(signal.aborted, true); fix.resolve(point);
  assert.equal(await pending, false); assert.equal(lookups, 0); assert.deepEqual(values, []);
});

test('the latest explicit map selection wins over a slower previous lookup', async () => {
  const first = deferred<DeliverySuggestion>(); const values: DeliverySuggestion[] = [];
  const flow = createDeliveryPositionRequest({ currentPosition: async () => point, locate: async (selected) => selected.lat === point.lat ? first.promise : suggestion(selected), busy() {}, error() {}, result: (value) => values.push(value) });
  const pending = flow.point(point); await Promise.resolve();
  assert.equal(await flow.point(nextPoint), true);
  first.resolve(suggestion(point)); assert.equal(await pending, false);
  assert.deepEqual(values, [suggestion(nextPoint)]);
});

test('leaving the screen or account disposal cannot publish a private delivery suggestion', async () => {
  const lookup = deferred<DeliverySuggestion>(); const values: DeliverySuggestion[] = [], errors: string[] = [];
  const flow = createDeliveryPositionRequest({ currentPosition: async () => point, locate: async () => lookup.promise, busy() {}, error: (value) => errors.push(value), result: (value) => values.push(value) });
  const pending = flow.point(point); await Promise.resolve(); flow.dispose(); lookup.resolve(suggestion());
  assert.equal(await pending, false); assert.deepEqual(values, []); assert.deepEqual(errors, ['']);
  assert.equal(await flow.current('self'), false);
});

test('map selection outside Nigeria and provider failure preserve manual delivery entry', async () => {
  let lookups = 0; const errors: string[] = [];
  const flow = createDeliveryPositionRequest({ currentPosition: async () => point, locate: async () => { lookups++; throw new Error('Address lookup is unavailable. Enter it manually.'); }, busy() {}, error: (value) => errors.push(value), result: () => assert.fail('No valid suggestion was returned') });
  assert.equal(await flow.point({ lat: 41.8781, lng: -87.6298 }), false);
  assert.equal(lookups, 0); assert.match(errors.at(-1)!, /Nigeria/);
  assert.equal(await flow.point(point), false); assert.equal(lookups, 1);
  assert.match(errors.at(-1)!, /manually/);
});
