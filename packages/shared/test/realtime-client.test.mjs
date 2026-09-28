import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeClient } from '../src/realtime-client.mjs';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness(options = {}) {
  const timers = new Map(), reads = []; let id = 0, refreshes = 0;
  const client = createRealtimeClient({ random: () => 0,
    setTimer: (run, ms) => { timers.set(++id, { run, ms }); return id; }, clearTimer: key => timers.delete(key),
    refresh: async () => { refreshes++; },
    read: (cursor, signal) => new Promise((resolve, reject) => reads.push({ cursor, signal, resolve, reject })), ...options,
  });
  return { client, reads, timers, refreshes: () => refreshes,
    async run(ms) { const entry = [...timers].find(([, timer]) => timer.ms === ms); assert.ok(entry, `Missing ${ms}ms timer`); timers.delete(entry[0]); entry[1].run(); await flush(); },
  };
}

test('one outstanding read resumes its durable cursor after backgrounding', async () => {
  const h = harness(); h.client.resume(); h.client.resume(); assert.equal(h.reads.length, 1);
  h.reads[0].resolve({ cursor: '17', changed: true }); await flush(); assert.equal(h.refreshes(), 1);
  await h.run(100); assert.equal(h.reads[1].cursor, '17');
  h.client.pause(); assert.equal(h.reads[1].signal.aborted, true); assert.equal(h.timers.size, 0);
  h.client.resume(); assert.equal(h.reads[2].cursor, '17');
  h.client.reset(); h.client.resume(); assert.equal(h.reads[3].cursor, '0');
  h.client.reset();
});

test('account reset ignores a late response and never reuses another account cursor', async () => {
  const h = harness(); h.client.resume(); h.client.reset(); h.client.resume();
  h.reads[0].resolve({ cursor: '55', changed: true }); await flush(); assert.equal(h.refreshes(), 0);
  h.reads[1].resolve({ cursor: '2', changed: false }); await flush(); await h.run(250);
  assert.equal(h.reads[2].cursor, '2'); h.client.reset();
});

test('a failed refresh does not acknowledge the cursor and connection retries back off', async () => {
  const errors = [], h = harness({ refresh: async () => { throw new Error('offline'); }, onError: e => errors.push(e) });
  h.client.resume(); h.reads[0].resolve({ cursor: '9', changed: true }); await flush();
  await h.run(1000); assert.equal(h.reads[1].cursor, '0');
  h.reads[1].reject(new Error('unavailable')); await flush(); await h.run(2000);
  assert.equal(errors.length, 2); h.client.reset();
});

test('slow fallback refresh remains available when the event request is pending', async () => {
  const h = harness(); h.client.resume(); await h.run(30_000);
  assert.equal(h.refreshes(), 1); assert.equal(h.reads.length, 1); h.client.reset();
});
