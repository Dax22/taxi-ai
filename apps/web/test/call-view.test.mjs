import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../public/dashboard/call-view.mjs', import.meta.url), 'utf8'))
  .replace("'/shared/call-lifecycle.mjs'", `'${new URL('../../../packages/shared/src/call-lifecycle.mjs', import.meta.url)}'`)
  .replace("'./dom.mjs'", `'${new URL('../public/dashboard/dom.mjs', import.meta.url)}'`);
const { createCallView } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
class NodeFixture {
  dataset = {}; handlers = {}; children = []; hidden = false; textContent = ''; srcObject = null;
  addEventListener(type, fn) { this.handlers[type] = fn; }
  setAttribute(name, value) { this[name] = value; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  pause() { this.paused = true; }
  play() { return this.playResult ?? Promise.resolve(); }
  fire(type) { return this.handlers[type]?.(); }
}
function setup(t) {
  const previous = globalThis.document, nodes = new Map(), actions = [];
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, new NodeFixture()); return nodes.get(id); };
  globalThis.document = { getElementById: node, createElement: () => new NodeFixture() };
  t.after(() => { globalThis.document = previous; });
  const view = createCallView(Object.fromEntries(['Start', 'Answer', 'Decline', 'End', 'Mute', 'OpenRide'].map((name) => [`on${name}`, (...args) => actions.push([name, ...args])])));
  return { view, node, actions };
}
const customer = { id: 'customer', name: 'Customer' }, driver = { id: 'driver', name: '<img src=x onerror=alert(1)>' };
const active = { id: 'call', rideId: 'ride', caller: driver, callee: customer, status: 'ringing', owned: false };
const state = { user: customer, selected: null, active, settings: { mode: 'local' }, recent: [], pending: null,
  connection: 'idle', error: '', supported: true, local: false, muted: false, canStart: false };

test('incoming call controls preserve plain-text peer names and show actual media state', (t) => {
  const { view, node, actions } = setup(t);
  view.render(state);
  assert.equal(node('call-answer').hidden, false); assert.equal(node('call-start').hidden, true);
  assert.equal(node('call-mute').hidden, true); assert.ok(node('call-title').textContent.includes(driver.name));
  node('call-answer').fire('click'); node('call-open-ride').fire('click');
  assert.deepEqual(actions, [['Answer'], ['OpenRide', 'ride']]);
  view.render({ ...state, active: { ...active, status: 'connected', owned: true }, local: true, connection: 'connecting', muted: true });
  assert.equal(node('call-status').textContent, 'Connecting audio…', 'server state alone must not claim working audio');
  assert.equal(node('call-mute').textContent, 'Unmute'); assert.equal(node('call-mute')['aria-pressed'], 'true');
  view.render({ ...state, active: { ...active, status: 'connected', owned: true }, local: true, connection: 'connected' });
  assert.equal(node('call-status').textContent, 'Audio connected');
});

test('autoplay rejection exposes an explicit playback button, while reset cancels delayed playback results', async (t) => {
  const { view, node } = setup(t), audio = node('call-audio');
  audio.playResult = Promise.reject(new Error('autoplay blocked'));
  view.remote({ id: 'remote' }); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(node('call-play-audio').hidden, false);
  audio.playResult = Promise.resolve(); await node('call-play-audio').fire('click');
  assert.equal(node('call-play-audio').hidden, true);
  let reject; audio.playResult = new Promise((_, no) => { reject = no; });
  view.remote({ id: 'next-remote' }); view.reset(); reject(new Error('late rejection'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(node('call-play-audio').hidden, true); assert.equal(audio.srcObject, null); assert.equal(audio.paused, true);
});
