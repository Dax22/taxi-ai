import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createDispatchWakeupSubscription, dispatchWakeupChannel, dispatchHintRegions, parseDispatchHint } from '../src/infrastructure/dispatch-wakeups.mjs';
import { createWorkerConfig } from '../src/infrastructure/worker-config.mjs';
import { createWorkerRuntime } from '../src/infrastructure/worker-runtime.mjs';

const flush = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() >= deadline) assert.fail('Condition did not become true.'); await delay(10); }
}
const coordinator = { acquire: async (name) => ({ name }), release: async () => true, renew: async () => true };
function fixture(t, { config: overrides = {}, dispatch = async () => {}, activeRegions = async (regions) => regions, acquire = coordinator.acquire } = {}) {
  let callbacks, subscriptions = 0, stopped = 0, reads = 0;
  const runtime = createWorkerRuntime({
    config: createWorkerConfig({ TAXI_AI_MATCHING_FAST_PATH: 'true', TAXI_AI_PROCESS_ROLE: 'worker', TAXI_AI_WORKER_INTERVAL_MS: '10000', ...overrides }),
    coordinator: { ...coordinator, acquire }, regions: async () => [], dispatch: { refresh: dispatch },
    wakeups: {
      subscribeDispatchWakeups(value) { callbacks = value; subscriptions++; return { stop: async () => { stopped++; } }; },
      async activeDispatchRegions(regions) { reads++; return activeRegions(regions); },
    },
  });
  t.after(() => runtime.stop()); runtime.start();
  return { runtime, hint: (hint) => callbacks?.onHint(hint), reconnect: () => callbacks?.onReconnect(),
    subscriptions: () => subscriptions, stopped: () => stopped, reads: () => reads };
}

test('wakeup payloads are bounded and schema scoped; availability includes adjacent request cells', () => {
  assert.notEqual(dispatchWakeupChannel('public'), dispatchWakeupChannel('test_schema'));
  assert.ok(dispatchWakeupChannel('public').length < 64);
  assert.deepEqual(parseDispatchHint('{"type":"ride","region":"ng:181:148"}'), { type: 'ride', region: 'ng:181:148' });
  for (const payload of ['{}', '[]', '{', '{"type":"other","region":"ng:181:148"}', '{"type":"ride","region":"private:user"}', 'x'.repeat(200)])
    assert.equal(parseDispatchHint(payload), null);
  const regions = dispatchHintRegions({ type: 'availability', region: 'ng:181:148' });
  assert.equal(regions.length, 49);
  assert.ok(regions.includes('ng:178:145') && regions.includes('ng:184:151'));
  assert.deepEqual(dispatchHintRegions({ type: 'availability', region: 'sample:wuse-ii' }), ['sample:wuse-ii']);
  assert.equal(dispatchHintRegions({ type: 'availability', region: 'ng:80:40' }).length, 16);
});

test('listener reconnects, recovers after LISTEN, ignores another schema, and stops cleanly', async (t) => {
  const clients = [], hints = []; let recoveries = 0;
  class Client extends EventEmitter {
    async connect() {}
    async query(text) { this.statement = text; }
    async end() { this.ended = true; }
  }
  const source = createDispatchWakeupSubscription({ schema: 'first', retryMs: 10,
    createClient: () => { const client = new Client(); clients.push(client); return client; },
    onHint: (hint) => hints.push(hint), onReconnect: () => recoveries++ });
  t.after(() => source.stop()); await flush();
  assert.equal(recoveries, 1);
  assert.equal(clients[0].statement, `LISTEN "${dispatchWakeupChannel('first')}"`);
  const message = { channel: dispatchWakeupChannel('first'), payload: '{"type":"ride","region":"sample:wuse-ii"}' };
  clients[0].emit('notification', { ...message, channel: dispatchWakeupChannel('other') });
  clients[0].emit('notification', message); assert.equal(hints.length, 1);
  clients[0].emit('error', new Error('connection lost')); await until(() => recoveries === 2);
  assert.equal(clients.length, 2);
  assert.equal(clients[0].ended, true);
  clients[0].emit('notification', message); assert.equal(hints.length, 1);
  clients[1].emit('notification', message); assert.equal(hints.length, 2);
  await source.stop(); clients[1].emit('notification', message);
  assert.equal(hints.length, 2); assert.equal(clients[1].ended, true);
});

test('wakeup bursts coalesce, wake before the polling interval, and honor regional rollout', async (t) => {
  const visits = [];
  const f = fixture(t, { config: { TAXI_AI_MATCHING_FAST_REGIONS: 'ng:181:148' }, dispatch: async ({ region }) => visits.push(region) });
  await flush();
  for (let i = 0; i < 100; i++) f.hint({ type: 'availability', region: 'ng:181:148' });
  await until(() => visits.length === 1);
  assert.deepEqual(visits, ['ng:181:148']); assert.equal(f.reads(), 1);
  await f.runtime.stop(); f.hint({ type: 'ride', region: 'ng:181:148' }); await flush();
  assert.equal(f.stopped(), 1); assert.equal(visits.length, 1);
});

test('a hint during active matching schedules exactly one later attempt', async (t) => {
  let release, count = 0;
  const f = fixture(t, { config: { TAXI_AI_WORKER_CONCURRENCY: '1' }, dispatch: async () => {
    count++; if (count === 1) await new Promise((resolve) => { release = resolve; });
  } });
  t.after(() => release?.()); await flush();
  f.hint({ type: 'ride', region: 'ng:181:148' }); await until(() => count === 1);
  for (let i = 0; i < 100; i++) f.hint({ type: 'ride', region: 'ng:181:148' });
  release(); await until(() => count === 2);
  await delay(100); assert.equal(count, 2);
});

test('wakeup does not retry a lease held elsewhere and a new hint can retry later', async (t) => {
  let attempts = 0;
  const f = fixture(t, { acquire: async (name) => { if (name.startsWith('dispatch:')) { attempts++; return null; } return { name }; } });
  await flush(); f.hint({ type: 'ride', region: 'ng:181:148' }); await until(() => attempts === 1);
  await delay(300); assert.equal(attempts, 1);
  f.hint({ type: 'ride', region: 'ng:181:148' }); await until(() => attempts === 2);
});

test('API and disabled runtimes do not subscribe; recovery works without a notification', async (t) => {
  for (const config of [{ TAXI_AI_PROCESS_ROLE: 'api' }, { TAXI_AI_MATCHING_FAST_PATH: 'false' }]) {
    const f = fixture(t, { config }); assert.equal(f.subscriptions(), 0); await f.runtime.stop();
  }
  let recover, available = false, visited = 0;
  const runtime = createWorkerRuntime({ config: createWorkerConfig({ TAXI_AI_MATCHING_FAST_PATH: 'true' }), coordinator,
    regions: async () => available ? ['ng:181:148'] : [], dispatch: { refresh: async () => visited++ },
    wakeups: { activeDispatchRegions: async () => [], subscribeDispatchWakeups({ onReconnect }) { recover = onReconnect; return { stop: async () => {} }; } } });
  t.after(() => runtime.stop()); runtime.start(); await flush();
  available = true; recover(); await until(() => visited === 1);
  await runtime.tick(); await until(() => visited === 2);
});

test('hints arriving during their database lookup remain queued and input is bounded', async (t) => {
  let unblock, entered = false; const visits = [], sizes = [];
  const f = fixture(t, { dispatch: async ({ region }) => visits.push(region), activeRegions: async (regions) => {
    sizes.push(regions.length);
    if (!entered) { entered = true; await new Promise((resolve) => { unblock = resolve; }); }
    return regions;
  } });
  t.after(() => unblock?.()); await flush();
  f.hint({ type: 'ride', region: 'ng:181:148' }); await until(() => entered);
  f.hint({ type: 'ride', region: 'ng:182:148' }); unblock();
  await until(() => visits.includes('ng:182:148'));
  for (let i = 0; i < 2000; i++) f.hint({ type: 'ride', region: `sample:area-${i}` });
  await until(() => sizes.length === 3); assert.equal(sizes[2], 512);
});

test('shutdown cancels a listener while its initial connection is still opening', async () => {
  let completeConnect, listened = false, recovered = false, ended = false;
  class Client extends EventEmitter {
    connect() { return new Promise((resolve) => { completeConnect = resolve; }); }
    async query() { listened = true; }
    async end() { ended = true; completeConnect(); }
  }
  const source = createDispatchWakeupSubscription({ schema: 'first', createClient: () => new Client(),
    onHint: () => assert.fail('Stopped listener cannot publish hints'), onReconnect: () => { recovered = true; } });
  await source.stop();
  assert.equal(ended, true); assert.equal(listened, false); assert.equal(recovered, false);
});
