import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../public/dashboard/call-controller.mjs', import.meta.url), 'utf8'))
  .replaceAll("'/shared/call-lifecycle.mjs'", `'${new URL('../../../packages/shared/src/call-lifecycle.mjs', import.meta.url)}'`)
  .replaceAll("'/shared/trip-lifecycle.mjs'", `'${new URL('../../../packages/shared/src/trip-lifecycle.mjs', import.meta.url)}'`);
const { createCallController } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const customer = { id: 'customer', name: 'Customer', role: 'customer' };
const driver = { id: 'driver', name: 'Driver', role: 'driver', driver: { status: 'approved' } };
const ride = { id: 'ride-one', customer, driver, status: 'negotiating' };
const call = (extra = {}) => ({ id: 'call-one', rideId: ride.id, caller: customer, callee: driver, status: 'ringing', version: 0, owned: true, ...extra });
const stream = () => { const track = { enabled: true, stops: 0, stop() { this.stops++; } }; return { track, getTracks: () => [track], getAudioTracks: () => [track] }; };

function setup(user = customer) {
  let time = 1000, sequence = 0;
  const f = { active: null, recent: [], commands: [], requests: [], acquisitions: 0, streams: [], peers: [], renders: [], clears: 0,
    settings: { enabled: true, mode: 'local' }, remote: null, state: null };
  const client = {
    async request(path, options) {
      f.requests.push({ path, options });
      if (f.requestHook) return f.requestHook(path, options);
      if (path === '/api/calls') return { active: f.active, recent: f.recent, settings: f.settings };
      if (path.endsWith('/pulse')) return { call: f.active };
      if (path.endsWith('/media')) return { call: f.active, configuration: { iceServers: [] }, remoteDescription: f.remote };
      throw new Error(`Unexpected request ${path}`);
    },
    async command(path, data, options) {
      f.commands.push({ path, data, options });
      if (f.commandHook) return f.commandHook(path, data, options);
      if (path.endsWith('/calls')) f.active = call({ id: `call-${++sequence}` });
      else if (path.endsWith('/accept')) f.active = { ...f.active, status: 'connecting', version: 1, owned: true };
      else if (path.endsWith('/end') || path.endsWith('/decline')) {
        const ended = { ...f.active, status: path.endsWith('/end') ? 'ended' : 'declined', owned: false };
        f.active = null; f.recent.unshift(ended); return { call: ended };
      }
      return { call: f.active };
    },
  };
  const media = {
    supported: () => true,
    async acquire() {
      f.acquisitions++;
      if (f.acquireHook) return f.acquireHook();
      const next = stream(); f.streams.push(next); return next;
    },
    stop(value) { value?.getTracks().forEach((track) => track.stop()); },
    connect(configuration, local, handlers) {
      const peer = { configuration, local, handlers, descriptions: [], answers: [], closed: false, live: false,
        connected() { return peer.live; },
        async describe(type, remote) {
          peer.descriptions.push({ type, remote });
          if (f.describeHook) return f.describeHook(type, remote);
          return { type, sdp: `test-sdp-${f.peers.length}` };
        },
        async accept(remote) { peer.answers.push(remote); },
        close() { peer.closed = true; },
      };
      f.peers.push(peer); return peer;
    },
  };
  const view = { render(value) { f.state = value; f.renders.push(value); }, reset() { f.state = null; },
    clearAudio() { f.clears++; }, remote(value) { f.playing = value; } };
  f.controller = createCallController({ client, media, view, makeId: () => 'test-window-id', now: () => time });
  f.controller.setContext(user, ride);
  f.advance = (ms) => { time += ms; };
  return f;
}

test('incoming polling never opens a microphone; Answer controls audio acquisition and negotiation', async () => {
  const f = setup(driver), c = f.controller;
  f.active = call({ owned: false }); await c.poll(); await c.poll();
  assert.equal(f.acquisitions, 0); assert.equal(f.peers.length, 0);
  await c.answer(); await flush();
  assert.equal(f.acquisitions, 1);
  assert.ok(f.commands[0].path.endsWith('/accept'));
  assert.deepEqual(f.commands[0].data, { expectedVersion: 0 });
  assert.equal(f.peers[0].descriptions.length, 0, 'recipient waits for the offer');
  f.remote = { type: 'offer', sdp: 'remote-offer' };
  await c.poll(); await flush();
  assert.deepEqual(f.peers[0].descriptions, [{ type: 'answer', remote: f.remote }]);
  assert.equal(f.commands.filter((r) => r.path.endsWith('/signal')).length, 1);
  c.reset(); assert.ok(f.streams[0].track.stops > 0); assert.equal(f.peers[0].closed, true);
});

test('caller waits for an answer, mutes actual tracks and stops media immediately even if hang-up cannot be saved', async () => {
  const f = setup(), c = f.controller;
  await c.poll(); await c.start(); await flush();
  assert.equal(f.peers.length, 0, 'ringing must not exchange audio setup');
  c.mute(); assert.equal(f.streams[0].track.enabled, false);
  c.mute(); assert.equal(f.streams[0].track.enabled, true);
  f.active = { ...f.active, status: 'connecting' };
  await c.poll(); await flush();
  assert.equal(f.peers[0].descriptions.length, 1);
  f.remote = { type: 'answer', sdp: 'remote-answer' };
  await c.poll(); await flush();
  assert.deepEqual(f.peers[0].answers, [f.remote]);
  f.peers[0].live = true; f.peers[0].handlers.onState('connected');
  assert.equal(c.snapshot().connection, 'connected');
  const ending = deferred(); f.commandHook = () => ending.promise;
  const done = c.end();
  assert.equal(c.hasMedia(), false); assert.ok(f.streams[0].track.stops > 0); assert.equal(f.peers[0].closed, true);
  ending.reject(new Error('offline')); await done;
  assert.match(c.snapshot().error, /microphone is off/);
  assert.equal(f.commands.filter((r) => /fare|offers/.test(r.path)).length, 0);
  assert.ok(f.requests.every((r) => r.options.callClient === 'test-window-id'));
});

test('late microphone permissions cannot resurrect a call after reset, journey change or setup cancellation', async () => {
  for (const cancel of [(c) => c.reset(), (c) => c.setContext(customer, { ...ride, id: 'another' }), (c) => c.end()]) {
    const f = setup(), permission = deferred(); f.acquireHook = () => permission.promise;
    await f.controller.poll(); const starting = f.controller.start();
    cancel(f.controller); const late = stream(); permission.resolve(late); await starting;
    assert.ok(late.track.stops > 0); assert.equal(f.commands.length, 0); assert.equal(f.controller.hasMedia(), false);
  }
});

test('a lost incoming call cancels pending permission, and a late creation reply is ended without reattaching media', async () => {
  const f = setup(driver), permission = deferred(); f.acquireHook = () => permission.promise;
  f.active = call({ owned: false }); await f.controller.poll();
  const answering = f.controller.answer(); f.active = null; await f.controller.poll();
  const late = stream(); permission.resolve(late); await answering;
  assert.ok(late.track.stops > 0); assert.equal(f.commands.length, 0);

  const other = setup(), creation = deferred();
  other.commandHook = async (path) => path.endsWith('/calls') ? creation.promise : { call: call({ status: 'ended' }) };
  await other.controller.poll(); const starting = other.controller.start(); await flush();
  other.controller.reset(); creation.resolve({ call: call() }); await starting; await flush();
  assert.ok(other.streams[0].track.stops > 0);
  assert.ok(other.commands.some((r) => r.path.endsWith('/end') && r.data.reason === 'client_closed'));
  assert.equal(other.controller.snapshot().active, null);
});

test('signaling retries reuse one SDP; a late description after hang-up cannot contaminate the next call', async () => {
  const f = setup(), c = f.controller;
  await c.poll(); await c.start(); await flush();
  f.active = { ...f.active, status: 'connecting' };
  f.commandHook = async () => { throw new Error('response lost'); };
  await c.poll(); await flush();
  assert.equal(f.peers[0].descriptions.length, 1);
  f.commandHook = null; await c.poll(); await flush();
  assert.equal(c.snapshot().error, '', 'successful signaling clears a transient retry error');
  const signals = f.commands.filter((r) => r.path.endsWith('/signal'));
  assert.equal(signals.length, 2); assert.deepEqual(signals[0].data, signals[1].data);
  await c.end();

  const description = deferred(); f.describeHook = () => description.promise;
  await c.start(); await flush(); f.active = { ...f.active, status: 'connecting' };
  await c.poll(); await flush();
  await c.end(); f.describeHook = null;
  await c.start(); await flush(); f.active = { ...f.active, status: 'connecting' };
  await c.poll(); await flush();
  const count = f.commands.length;
  description.resolve({ type: 'offer', sdp: 'stale-sdp' }); await flush();
  assert.equal(f.commands.length, count);
  assert.ok(!f.commands.some((r) => r.data.sdp === 'stale-sdp'));
  await c.end();
});

test('remote closure, session rejection and ownership changes clear tracks; missing local audio is never reacquired', async () => {
  for (const change of ['remote-ended', 'other-window', 'unauthenticated']) {
    const f = setup(), c = f.controller;
    await c.poll(); await c.start(); await flush();
    if (change === 'remote-ended') f.active = null;
    if (change === 'other-window') f.active = { ...f.active, owned: false };
    if (change === 'unauthenticated') f.requestHook = async () => { throw Object.assign(new Error('expired'), { status: 401 }); };
    await c.poll();
    assert.ok(f.streams[0].track.stops > 0, change); assert.equal(c.hasMedia(), false, change);
    assert.equal(f.acquisitions, 1);
  }
  const f = setup(); f.active = call();
  await f.controller.poll(); await flush();
  assert.equal(f.acquisitions, 0); assert.equal(f.commands[0].data.reason, 'client_closed');
});

test('timeouts stop tracks even without a response and a disconnected peer gets a bounded recovery window', async () => {
  const f = setup(), c = f.controller;
  await c.poll(); await c.start(); await flush();
  f.advance(14_999); c.tick(); assert.equal(c.hasMedia(), true);
  f.advance(1); c.tick(); assert.equal(c.hasMedia(), false); await flush();
  assert.equal(f.commands.at(-1).data.reason, 'media_failed');
  await c.start(); await flush(); f.active = { ...f.active, status: 'connecting' };
  await c.poll(); await flush();
  f.peers.at(-1).handlers.onState('disconnected');
  f.advance(7999); c.tick(); assert.equal(c.hasMedia(), true);
  f.advance(1); c.tick(); assert.equal(c.hasMedia(), false); await flush();
});

test('declining and microphone denial never acquire transport; closed journeys end an existing call', async () => {
  const incoming = setup(driver); incoming.active = call({ owned: false });
  await incoming.controller.poll(); await incoming.controller.decline();
  assert.equal(incoming.acquisitions, 0); assert.equal(incoming.peers.length, 0);
  const denied = setup(); denied.acquireHook = async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); };
  await denied.controller.poll(); await denied.controller.start();
  assert.match(denied.controller.snapshot().error, /not granted/); assert.equal(denied.commands.length, 0);
  const f = setup(); await f.controller.poll(); await f.controller.start(); await flush();
  f.controller.setContext(customer, { ...ride, status: 'completed' });
  assert.equal(f.controller.hasMedia(), false); await flush();
  assert.ok(f.commands.at(-1).path.endsWith('/end'));
});
