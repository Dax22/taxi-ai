import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createCurrentDeliveryPosition } from '../src/eats/delivery-location-core.ts';
import { OUTSIDE_NIGERIA_FOOD_MESSAGE } from '../../../packages/shared/src/eats-delivery.mjs';
import type { DeliveryLocationFix } from '../src/eats/delivery-location-core.ts';

const epoch = 1_000_000;
const freshFix = (): DeliveryLocationFix => ({ coords: { latitude: 6.6018, longitude: 3.3515, accuracy: 20 }, timestamp: epoch });
const flush = async () => { for (let i = 0; i < 16; i += 1) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function clock() {
  let time = epoch, sequence = 0;
  const timers = new Map<number, { deadline: number; callback: () => void }>();
  return {
    now: () => time,
    scheduleTimeout: (callback: () => void, delayMs: number) => {
      const id = ++sequence;
      timers.set(id, { deadline: time + delayMs, callback }); return id;
    },
    cancelTimeout: (handle: unknown) => { timers.delete(handle as number); },
    tick: (ms: number) => {
      time += ms;
      for (const [id, timer] of timers) if (timer.deadline <= time) { timers.delete(id); timer.callback(); }
    },
    pending: () => timers.size,
  };
}

test('delivery GPS is inert until explicitly requested and waits for foreground permission', async () => {
  const permission = deferred<{ granted: boolean }>(), time = clock();
  let permissions = 0, acquisitions = 0;
  const acquire = createCurrentDeliveryPosition({ ...time,
    requestPermission: () => { permissions += 1; return permission.promise; },
    getCurrentFix: async () => { acquisitions += 1; return freshFix(); },
  });
  assert.equal(permissions, 0); assert.equal(acquisitions, 0); assert.equal(time.pending(), 0);
  const result = acquire(); await flush();
  assert.equal(permissions, 1); assert.equal(acquisitions, 0); assert.equal(time.pending(), 0);
  permission.resolve({ granted: true });
  assert.deepEqual(await result, { lat: 6.6018, lng: 3.3515, accuracy: 20, capturedAt: epoch });
  assert.equal(acquisitions, 1); assert.equal(time.pending(), 0);
});

test('denied foreground permission never acquires a fix or starts a timeout', async () => {
  const time = clock(); let acquisitions = 0;
  const acquire = createCurrentDeliveryPosition({ ...time, requestPermission: async () => ({ granted: false }),
    getCurrentFix: async () => { acquisitions += 1; return freshFix(); } });
  await assert.rejects(acquire(), /Allow location access.*delivery location/);
  assert.equal(acquisitions, 0); assert.equal(time.pending(), 0);
});

test('an already cancelled delivery request never asks for permission or acquires GPS', async () => {
  const controller = new AbortController(), time = clock(); let permissions = 0, acquisitions = 0;
  controller.abort();
  const acquire = createCurrentDeliveryPosition({ ...time,
    requestPermission: async () => { permissions += 1; return { granted: true }; },
    getCurrentFix: async () => { acquisitions += 1; return freshFix(); },
  });
  await assert.rejects(acquire(controller.signal), { name: 'AbortError', message: 'Delivery location request was cancelled.' });
  assert.equal(permissions, 0); assert.equal(acquisitions, 0); assert.equal(time.pending(), 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('cancelling while foreground permission is pending settles promptly and prevents later GPS acquisition', async () => {
  const controller = new AbortController(), permission = deferred<{ granted: boolean }>(), time = clock(); let acquisitions = 0;
  const acquire = createCurrentDeliveryPosition({ ...time, requestPermission: () => permission.promise,
    getCurrentFix: async () => { acquisitions += 1; return freshFix(); },
  });
  const rejected = assert.rejects(acquire(controller.signal), { name: 'AbortError' });
  await flush(); controller.abort(); await rejected;
  assert.equal(time.pending(), 0); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  permission.resolve({ granted: true }); await flush();
  assert.equal(acquisitions, 0); assert.equal(time.pending(), 0);
});

test('cancelling delivery GPS clears the deadline and listener and ignores a late fix', async () => {
  const controller = new AbortController(), fix = deferred<DeliveryLocationFix>(), time = clock(); let returned = false;
  const acquire = createCurrentDeliveryPosition({ ...time, requestPermission: async () => ({ granted: true }), getCurrentFix: () => fix.promise });
  const rejected = assert.rejects(acquire(controller.signal).then(() => { returned = true; }), { name: 'AbortError' });
  await flush(); assert.equal(time.pending(), 1); assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  controller.abort(); await rejected;
  assert.equal(time.pending(), 0); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  fix.resolve(freshFix()); await flush(); time.tick(20_000); await flush();
  assert.equal(returned, false);
});

test('successful delivery GPS also removes its abort listener', async () => {
  const controller = new AbortController(), time = clock();
  const acquire = createCurrentDeliveryPosition({ ...time, requestPermission: async () => ({ granted: true }), getCurrentFix: async () => freshFix() });
  assert.equal((await acquire(controller.signal)).lat, 6.6018);
  assert.equal(time.pending(), 0); assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  controller.abort(); await flush();
});

test('delivery acquisition times out at ten seconds and ignores a later successful fix', async () => {
  const fix = deferred<DeliveryLocationFix>(), time = clock(); let returned = false;
  const acquire = createCurrentDeliveryPosition({ ...time, requestPermission: async () => ({ granted: true }), getCurrentFix: () => fix.promise });
  const result = acquire().then((value) => { returned = true; return value; });
  const rejected = assert.rejects(result, /fresh delivery location is unavailable/);
  await flush(); time.tick(9_999); await flush();
  assert.equal(returned, false); assert.equal(time.pending(), 1);
  time.tick(1); await rejected; assert.equal(time.pending(), 0);
  fix.resolve({ ...freshFix(), timestamp: time.now() }); await flush();
  assert.equal(returned, false);
});

test('late provider rejection after timeout is handled without replacing the timeout result', async () => {
  const fix = deferred<DeliveryLocationFix>(), time = clock();
  const acquire = createCurrentDeliveryPosition({ ...time, requestPermission: async () => ({ granted: true }), getCurrentFix: () => fix.promise });
  const rejected = assert.rejects(acquire(), /fresh delivery location is unavailable/);
  await flush(); time.tick(10_000); await rejected;
  fix.reject(new Error('provider unavailable')); await flush(); assert.equal(time.pending(), 0);
});

test('delivery fixes enforce freshness, clock skew and valid timestamps', async () => {
  for (const timestamp of [epoch - 30_001, epoch + 5_001, NaN, Infinity, 0]) {
    const time = clock(), acquire = createCurrentDeliveryPosition({ ...time, requestPermission: async () => ({ granted: true }),
      getCurrentFix: async () => ({ ...freshFix(), timestamp }) });
    await assert.rejects(acquire(), /fresh delivery location is unavailable/); assert.equal(time.pending(), 0);
  }
  for (const timestamp of [epoch - 30_000, epoch + 5_000]) {
    const acquire = createCurrentDeliveryPosition({ ...clock(), requestPermission: async () => ({ granted: true }),
      getCurrentFix: async () => ({ ...freshFix(), timestamp }) });
    assert.equal((await acquire()).capturedAt, timestamp);
  }
});

test('delivery freshness is checked at completion rather than before acquiring the fix', async () => {
  const fix = deferred<DeliveryLocationFix>(), time = clock();
  const acquire = createCurrentDeliveryPosition({ ...time, requestPermission: async () => ({ granted: true }), getCurrentFix: () => fix.promise });
  const rejected = assert.rejects(acquire(), /fresh delivery location is unavailable/);
  await flush(); time.tick(2_000); fix.resolve({ ...freshFix(), timestamp: epoch - 29_000 });
  await rejected; assert.equal(time.pending(), 0);
});

test('delivery accuracy must be finite, positive and at most 200 metres', async () => {
  for (const accuracy of [null, NaN, Infinity, 0, -1, 200.01]) {
    const fix = freshFix(); fix.coords.accuracy = accuracy;
    const acquire = createCurrentDeliveryPosition({ ...clock(), requestPermission: async () => ({ granted: true }), getCurrentFix: async () => fix });
    await assert.rejects(acquire(), /delivery location is not accurate enough/);
  }
  const fix = freshFix(); fix.coords.accuracy = 200;
  const acquire = createCurrentDeliveryPosition({ ...clock(), requestPermission: async () => ({ granted: true }), getCurrentFix: async () => fix });
  assert.equal((await acquire()).accuracy, 200);
});

test('Chicago and points inside the Nigeria display bounds but outside its polygon get food-specific guidance', async () => {
  for (const [latitude, longitude] of [[41.8781, -87.6298], [10, 3]]) {
    const fix = freshFix(); Object.assign(fix.coords, { latitude, longitude });
    const acquire = createCurrentDeliveryPosition({ ...clock(), requestPermission: async () => ({ granted: true }), getCurrentFix: async () => fix });
    await assert.rejects(acquire(), { message: OUTSIDE_NIGERIA_FOOD_MESSAGE });
  }
  assert.doesNotMatch(OUTSIDE_NIGERIA_FOOD_MESSAGE, /pickup|ride|fare/i);
});

test('malformed coordinates and provider failures use delivery-specific errors', async () => {
  for (const [latitude, longitude] of [[NaN, 3.35], [6.6, Infinity], [91, 3.35], [6.6, 181]]) {
    const fix = freshFix(); Object.assign(fix.coords, { latitude, longitude });
    const acquire = createCurrentDeliveryPosition({ ...clock(), requestPermission: async () => ({ granted: true }), getCurrentFix: async () => fix });
    await assert.rejects(acquire(), /delivery location is unavailable/);
  }
  for (const failing of ['permission', 'fix']) {
    const time = clock(), acquire = createCurrentDeliveryPosition({ ...time,
      requestPermission: async () => { if (failing === 'permission') throw new Error('OS error'); return { granted: true }; },
      getCurrentFix: async () => { throw new Error('OS error'); },
    });
    await assert.rejects(acquire(), /delivery location is unavailable/); assert.equal(time.pending(), 0);
  }
});
