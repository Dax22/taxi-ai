import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallMedia } from '../public/dashboard/call-media.mjs';

class Events {
  handlers = new Map();
  addEventListener(name, fn) { if (!this.handlers.has(name)) this.handlers.set(name, new Set()); this.handlers.get(name).add(fn); }
  removeEventListener(name, fn) { this.handlers.get(name)?.delete(fn); }
  fire(name, event) { for (const fn of this.handlers.get(name) ?? []) fn(event); }
}
function setup() {
  let peer;
  const states = [], remotes = [], timers = new Set(), permissions = [];
  class Peer extends Events {
    iceGatheringState = 'new'; connectionState = 'new'; tracks = [];
    constructor(config) { super(); peer = this; this.config = config; }
    addTrack(...args) { this.tracks.push(args); }
    async createOffer() { return { type: 'offer', sdp: 'before-candidates' }; }
    async createAnswer() { assert.equal(this.remoteDescription.type, 'offer'); return { type: 'answer', sdp: 'before-candidates' }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) { this.remoteDescription = value; }
    close() { this.connectionState = 'closed'; this.fire('connectionstatechange'); }
  }
  const track = Object.assign(new Events(), { kind: 'audio', stops: 0, stop() { this.stops++; } });
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  const media = createCallMedia({ secure: true, Peer, Stream: class { constructor(tracks) { this.tracks = tracks; } },
    devices: { async getUserMedia(options) { permissions.push(options); return stream; } },
    timeout(fn) { timers.add(fn); return fn; }, clear(fn) { timers.delete(fn); },
  });
  const transport = media.connect({ iceTransportPolicy: 'relay', iceServers: [{ urls: ['turn:example.test'] }] }, stream,
    { onState: (state) => states.push(state), onRemote: (remote) => remotes.push(remote) });
  return { media, transport, get peer() { return peer; }, states, remotes, timers, permissions, stream, track };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('audio adapter requests no video and waits for complete ICE data before publishing a description', async () => {
  const f = setup(); assert.equal(f.media.supported(), true); assert.equal(f.permissions.length, 0);
  await f.media.acquire(); assert.equal(f.permissions[0].video, false);
  assert.equal(f.peer.tracks[0][0], f.track); assert.equal(f.peer.config.iceTransportPolicy, 'relay');
  let done = false;
  const description = f.transport.describe('offer').then((value) => { done = true; return value; });
  await flush(); assert.equal(done, false); assert.equal(f.timers.size, 1);
  f.peer.localDescription.sdp = 'with-candidates'; f.peer.iceGatheringState = 'complete'; f.peer.fire('icegatheringstatechange');
  assert.deepEqual(await description, { type: 'offer', sdp: 'with-candidates' }); assert.equal(f.timers.size, 0);
  await f.transport.accept({ type: 'answer', sdp: 'remote' }); assert.equal(f.peer.remoteDescription.type, 'answer');
  f.peer.connectionState = 'connected'; f.peer.fire('connectionstatechange'); assert.equal(f.transport.connected(), true);
  const remote = {}; f.peer.fire('track', { track: { kind: 'audio' }, streams: [remote] });
  f.peer.fire('track', { track: { kind: 'video' }, streams: [{}] }); assert.deepEqual(f.remotes, [remote]);
  f.transport.close(); f.media.stop(f.stream);
  assert.equal(f.track.stops, 1); assert.deepEqual(f.states, ['connected']);
  f.peer.fire('track', { track: { kind: 'audio' }, streams: [{}] }); assert.deepEqual(f.remotes, [remote]);
});

test('hang-up and timeout reject incomplete ICE gathering and remove timers/listeners', async () => {
  for (const action of ['close', 'timeout']) {
    const f = setup();
    const description = f.transport.describe('answer', { type: 'offer', sdp: 'remote' });
    const rejection = assert.rejects(description, action === 'close' ? /ended/ : /timed out/);
    await flush();
    if (action === 'close') f.transport.close(); else [...f.timers][0]();
    await rejection; assert.equal(f.timers.size, 0); assert.equal(f.peer.handlers.get('icegatheringstatechange').size, 0);
    f.transport.close(); f.media.stop(f.stream);
  }
});

test('revoked microphone emits failure only while the transport is live; insecure or unsupported clients are gated', () => {
  const f = setup(); f.track.fire('ended'); assert.deepEqual(f.states, ['failed']);
  f.transport.close(); f.track.fire('ended'); assert.deepEqual(f.states, ['failed']);
  assert.equal(createCallMedia({ secure: false, Peer: class {}, devices: { getUserMedia() {} } }).supported(), false);
  assert.equal(createCallMedia({ secure: true, Peer: null, devices: {} }).supported(), false);
});
