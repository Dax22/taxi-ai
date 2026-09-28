import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
async function moduleUrl(url, dependencies = {}) {
  const source = (await readFile(url, 'utf8')).replace(/from\s+(['"])(.*?)\1/g, (_, quote, specifier) => {
    const resolved = dependencies[specifier] ?? (specifier.startsWith('/shared/')
      ? new URL('../../../packages/shared/src/' + specifier.slice(8), import.meta.url).href
      : new URL(specifier, url).href);
    return `from '${resolved}'`;
  });
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
const entry = await moduleUrl(new URL('../public/app.mjs', import.meta.url), {
  './dashboard/vehicle-categories.mjs': await moduleUrl(new URL('../public/dashboard/vehicle-categories.mjs', import.meta.url)),
});
let sequence = 0;

// Execute the complete shipped entry against strict HTML IDs. This fixture does not test browser layout or native navigation.
class ElementFixture {
  constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.value = ''; this.handlers = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  focus() { this.focused = true; }
}
async function setup(t, legacy = false) {
  const oldDocument = globalThis.document, oldLocation = globalThis.location;
  const elements = [], ids = new Map(), navigations = [];
  for (const [, tag, attributes] of html.matchAll(/<(\w+)\b([^>]*)>/g)) {
    const element = new ElementFixture(tag);
    for (const [, name, value] of attributes.matchAll(/([\w-]+)="([^"]*)"/g)) {
      element[name] = value;
      if (name.startsWith('data-')) element.dataset[name.slice(5)] = value;
    }
    element.hidden = /\shidden(?:\s|$)/.test(attributes);
    elements.push(element); if (element.id) ids.set(element.id, element);
  }
  if (legacy) {
    for (const type of ['tab', 'service', 'switch']) {
      const element = new ElementFixture(type === 'service' ? 'a' : 'button');
      element.dataset[type] = 'courier'; elements.push(element); ids.set(`legacy-${type}`, element);
    }
  }
  const node = (id) => { assert.ok(ids.has(id), `Missing shipped homepage element #${id}`); return ids.get(id); };
  globalThis.document = {
    getElementById: node, createElement: (tag) => new ElementFixture(tag),
    querySelectorAll(selector) {
      const key = /^\[data-([\w-]+)\]$/.exec(selector)?.[1];
      assert.ok(key, `Unsupported fixture selector ${selector}`);
      return elements.filter((element) => key in element.dataset);
    },
  };
  globalThis.location = { assign: (href) => navigations.push(href) };
  t.after(() => { globalThis.document = oldDocument; globalThis.location = oldLocation; });
  await import(`${entry}#fixture-${++sequence}`);
  return { node, navigations };
}

test('full homepage initializes the vehicle picker and preserves Courier as a direct booking link', async (t) => {
  const h = await setup(t), link = h.node('courier-booking-link');
  assert.equal(link.tag, 'a'); assert.equal(link.href, '/app?service=courier');
  assert.equal(link.role, undefined); assert.equal(link.handlers.click, undefined);
  const picker = h.node('home-vehicle-categories').children[0];
  assert.ok(picker.children.length > 1, 'the real vehicle picker initialized before navigation bindings');
  picker.children[1].handlers.click();
  assert.equal(h.node('category-booking-link').href, `/app?category=${picker.children[1].dataset.category}`);
  assert.deepEqual(h.navigations, []);
});

test('Ride and Eats clicks and keyboard navigation remain usable without the removed Courier panel', async (t) => {
  const h = await setup(t);
  h.node('tab-eats').handlers.click();
  assert.equal(h.node('panel-eats').hidden, false); assert.equal(h.node('panel-ride').hidden, true);
  for (const [from, key, selected] of [
    ['eats', 'ArrowRight', 'ride'], ['ride', 'ArrowRight', 'eats'],
    ['eats', 'Home', 'ride'], ['ride', 'End', 'eats'], ['eats', 'ArrowLeft', 'ride'],
  ]) {
    let prevented = false;
    h.node(`tab-${from}`).handlers.keydown({ key, preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(h.node(`tab-${selected}`).focused, true);
    assert.equal(h.node(`tab-${selected}`)['aria-selected'], 'true');
    assert.equal(h.node(`tab-${selected}`).tabIndex, 0);
    assert.equal(h.node(`panel-${selected}`).hidden, false);
  }
  assert.deepEqual(h.navigations, []);
});

test('legacy Courier controls navigate to parcel booking instead of requiring a removed panel', async (t) => {
  const h = await setup(t, true);
  let prevented = false;
  h.node('legacy-service').handlers.click({ preventDefault() { prevented = true; } });
  h.node('legacy-tab').handlers.click(); h.node('legacy-switch').handlers.click();
  assert.equal(prevented, true);
  assert.deepEqual(h.navigations, Array(3).fill('/app?service=courier'));
});
