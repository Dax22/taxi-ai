import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageScene } from '../public/page-scenes.mjs';

const dataKey = name => name.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
class Element extends EventTarget {
  constructor(tag = 'div') {
    super(); this.tagName = tag.toUpperCase(); this.dataset = {}; this.attributes = {}; this.children = [];
    this.hidden = false; this.className = ''; this.textContent = ''; this.style = {}; this.parentElement = null;
    this.complete = false; this.naturalWidth = 0; this.value = '';
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
      toggle: (name, force) => {
        const add = force ?? !this.classList.contains(name);
        this.classList[add ? 'add' : 'remove'](name); return add;
      },
    };
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) this.dataset[dataKey(name)] = String(value);
    else if (name === 'class') this.className = String(value);
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  get firstElementChild() { return this.children[0] ?? null; }
  get src() { return this.attributes.src ?? ''; }
  set src(value) { this.attributes.src = String(value); this.complete = false; this.naturalWidth = 0; }
  removeAttribute(name) { delete this.attributes[name]; if (name.startsWith('data-')) delete this.dataset[dataKey(name)]; }
  append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
  appendChild(child) { this.append(child); return child; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  contains(element) { return this === element || this.children.some(child => child.contains(element)); }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (/^\[data-[a-z-]+\]$/.test(selector)) return Object.hasOwn(this.dataset, dataKey(selector.slice(1, -1)));
    return this.tagName.toLowerCase() === selector;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  emit(type, values = {}) {
    if (type === 'load') { this.complete = true; this.naturalWidth = 1536; }
    if (type === 'error') { this.complete = true; this.naturalWidth = 0; }
    const event = Object.assign(new Event(type), values);
    this.dispatchEvent(event); this[`on${type}`]?.(event);
  }
}

function setup({ reduced = false, hidden = false, focused = false } = {}) {
  const root = new Element(), original = new Element('img'), documentRef = new Element('document');
  const windowRef = new Element('window'), motion = new Element(), form = new Element('form'), input = new Element('input');
  root.dataset.pageScene = 'rides'; original.className = 'page-scene-image';
  original.src = '/assets/scenes/ride-city.webp'; original.setAttribute('src', original.src);
  original.alt = ''; original.complete = true; original.naturalWidth = 1536;
  root.append(original); input.value = 'Existing pickup'; form.append(input);
  documentRef.append(root, form); documentRef.hidden = hidden; documentRef.activeElement = focused ? root : input;
  const created = [];
  documentRef.createElement = tag => { const element = new Element(tag); created.push(element); return element; };
  documentRef.defaultView = windowRef; root.ownerDocument = documentRef;
  motion.matches = reduced; windowRef.matchMedia = query => query.includes('reduced-motion') ? motion : { matches: false };
  const timers = new Map(), frames = new Map(), observers = []; let sequence = 0;
  windowRef.setTimeout = (fn, delay) => { const id = ++sequence; timers.set(id, { fn, delay }); return id; };
  windowRef.clearTimeout = id => timers.delete(id);
  windowRef.requestAnimationFrame = fn => { const id = ++sequence; frames.set(id, fn); return id; };
  windowRef.cancelAnimationFrame = id => frames.delete(id);
  windowRef.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  };
  const scene = createPageScene(root, { documentRef, windowRef, intervalMs: 11000 });
  const runTimer = ([id, timer]) => { timers.delete(id); timer.fn(); };
  return { root, original, documentRef, windowRef, motion, form, input, timers, frames, observers, created, scene,
    node: name => root.querySelector(`[data-scene-${name}]`),
    images: () => root.querySelectorAll('img'),
    current: () => root.querySelectorAll('img').find(image => image.dataset.sceneCurrent === 'true'),
    pending: () => created.filter(image => image.tagName === 'IMG' && image.parentElement === null).at(-1),
    autoTimers: () => [...timers].filter(([, timer]) => timer.delay === 11000),
    tick() { const auto = [...timers].filter(([, timer]) => timer.delay === 11000); assert.equal(auto.length, 1); runTimer(auto[0]); },
    finishTransition() {
      for (let i = 0; i < 4 && frames.size; i++) for (const [id, fn] of [...frames]) { frames.delete(id); fn(); }
      for (const timer of [...timers].filter(([, value]) => value.delay < 11000)) runTimer(timer);
    },
    visible(value) { for (const observer of observers) if (!observer.disconnected) observer.callback([{ target: root, isIntersecting: value, intersectionRatio: value ? 1 : 0 }]); },
  };
}

test('the original scene stays visible until a replacement loads and survives an image failure', () => {
  const f = setup(); f.visible(true);
  assert.equal(f.current(), f.original); const source = f.original.src;
  f.node('next').emit('click'); const pending = f.pending();
  assert.ok(pending); assert.equal(f.current(), f.original);
  pending.emit('error');
  assert.equal(f.current(), f.original); assert.equal(f.original.src, source);
  assert.equal(f.root.contains(f.original), true);
});

test('manual navigation commits a loaded image, announces it, and leaves rotation paused', () => {
  const f = setup(); f.visible(true); f.node('next').emit('click');
  const pending = f.pending(); assert.ok(pending); pending.emit('load');
  assert.equal(f.current(), pending); assert.notEqual(f.node('status').textContent, '');
  assert.equal(f.autoTimers().length, 0); assert.equal(f.images().length <= 3, true);
  assert.equal(f.root.contains(f.original), true);
  f.node('previous').emit('click'); f.pending()?.emit('load');
  assert.equal(f.current().src, f.original.src); assert.equal(f.autoTimers().length, 0);
});

test('focus and explicit Pause remain paused through visibility changes until Play is chosen', () => {
  const f = setup(); f.visible(true); assert.equal(f.autoTimers().length, 1);
  f.root.emit('focusin'); assert.equal(f.autoTimers().length, 0);
  f.documentRef.hidden = true; f.documentRef.emit('visibilitychange');
  f.documentRef.hidden = false; f.documentRef.emit('visibilitychange');
  f.windowRef.emit('pagehide'); f.windowRef.emit('pageshow');
  assert.equal(f.autoTimers().length, 0);
  f.node('play').emit('click', { detail: 0 }); assert.equal(f.autoTimers().length, 1);
  f.node('play').emit('pointerdown'); f.root.emit('focusin'); f.node('play').emit('click', { detail: 1 });
  assert.equal(f.autoTimers().length, 0);
  assert.equal(setup({ focused: true }).autoTimers().length, 0);
});

test('reduced motion allows manual scenes but never silently enables automatic rotation', () => {
  const f = setup({ reduced: true }); f.visible(true);
  assert.equal(f.autoTimers().length, 0); assert.equal(f.node('play').disabled, true);
  f.node('play').emit('click', { detail: 0 }); assert.equal(f.autoTimers().length, 0);
  f.node('next').emit('click'); const pending = f.pending(); pending.emit('load'); assert.equal(f.current(), pending);
  f.motion.matches = false; f.motion.emit('change');
  assert.equal(f.node('play').disabled, false); assert.equal(f.autoTimers().length, 0);
  f.node('play').emit('click', { detail: 0 }); assert.equal(f.autoTimers().length, 1);
  f.motion.matches = true; f.motion.emit('change'); assert.equal(f.autoTimers().length, 0);
});

test('offscreen, hidden, and page-cache lifecycles suspend rotation and never duplicate timers', () => {
  const f = setup(); assert.equal(f.autoTimers().length, 0);
  f.visible(true); assert.equal(f.autoTimers().length, 1);
  f.documentRef.hidden = true; f.documentRef.emit('visibilitychange'); assert.equal(f.autoTimers().length, 0);
  f.documentRef.hidden = false; f.documentRef.emit('visibilitychange'); assert.equal(f.autoTimers().length, 1);
  f.visible(false); assert.equal(f.autoTimers().length, 0);
  f.visible(true); assert.equal(f.autoTimers().length, 1);
  f.windowRef.emit('pagehide'); assert.equal(f.autoTimers().length, 0);
  f.windowRef.emit('pageshow'); f.windowRef.emit('pageshow'); f.visible(true);
  assert.equal(f.autoTimers().length, 1);
  f.tick(); f.pending()?.emit('load');
  assert.equal(f.node('status').textContent, ''); assert.equal(f.autoTimers().length <= 1, true);
});

test('theme changes preserve an explicit pause and never mutate the original fallback or sibling form', () => {
  const f = setup(); f.visible(true); const originalSource = f.original.src;
  const formChildren = [...f.form.children]; let submitted = 0;
  f.form.addEventListener('submit', () => { submitted++; });
  f.node('play').emit('click', { detail: 0 }); f.scene.setTheme('account');
  assert.equal(f.autoTimers().length, 0);
  f.node('next').emit('click'); f.pending()?.emit('load');
  assert.equal(f.autoTimers().length, 0); assert.equal(f.original.src, originalSource);
  assert.equal(f.input.value, 'Existing pickup'); assert.deepEqual(f.form.children, formChildren); assert.equal(submitted, 0);
  for (const name of ['play', 'previous', 'next']) assert.equal(f.node(name).type, 'button');
});

test('a theme changed while hidden displays its first loaded scene on return without overriding Pause', () => {
  const f = setup(); f.visible(true); f.node('play').emit('click', { detail: 0 });
  f.documentRef.hidden = true; f.documentRef.emit('visibilitychange'); f.scene.setTheme('food');
  assert.equal(f.current(), f.original); assert.equal(f.autoTimers().length, 0);
  f.documentRef.hidden = false; f.documentRef.emit('visibilitychange');
  const pending = f.pending(); assert.equal(pending.src, '/assets/scenes/eats-table.webp');
  pending.emit('load'); assert.equal(f.current(), pending); assert.equal(f.autoTimers().length, 0);
  assert.equal(f.node('status').textContent, '');
});

test('a failed first photo in a new theme keeps the valid scene without repeatedly retrying it', () => {
  const f = setup(); f.visible(true); f.node('play').emit('click', { detail: 0 }); f.scene.setTheme('food');
  const failed = f.pending(); assert.equal(failed.src, '/assets/scenes/eats-table.webp'); failed.emit('error');
  const created = f.created.length;
  f.documentRef.emit('visibilitychange'); f.windowRef.emit('pageshow'); f.visible(true);
  assert.equal(f.created.length, created); assert.equal(f.current(), f.original); assert.equal(f.autoTimers().length, 0);
  f.node('next').emit('click'); const next = f.pending();
  assert.equal(next.src, '/assets/eats-jollof.jpg'); next.emit('load');
  assert.equal(f.current(), next); assert.equal(f.autoTimers().length, 0);
});

test('an image finishing after pagehide cannot replace the visible photo or restart automatic work', () => {
  const f = setup(); f.visible(true); f.tick(); const pending = f.pending();
  f.windowRef.emit('pagehide'); pending.emit('load');
  assert.equal(f.current(), f.original); assert.equal(f.autoTimers().length, 0);
  f.windowRef.emit('pageshow'); assert.equal(f.current(), f.original); assert.equal(f.autoTimers().length, 1);
  f.tick(); assert.equal(f.current(), pending); assert.equal(f.autoTimers().length, 1);
});

test('destroy cancels lifecycle work and ignores pending image and detached control events', () => {
  const f = setup(); f.visible(true); f.node('next').emit('click');
  const pending = f.pending(), next = f.node('next'), play = f.node('play');
  f.scene.destroy(); assert.equal(f.timers.size, 0); assert.equal(f.frames.size, 0);
  assert.deepEqual(f.images(), [f.original]); assert.ok(f.observers.every(observer => observer.disconnected));
  const children = [...f.root.children];
  pending.emit('load'); pending.emit('error'); next.emit('click'); play.emit('click', { detail: 0 });
  f.windowRef.emit('pageshow'); f.documentRef.emit('visibilitychange'); f.motion.emit('change');
  assert.deepEqual(f.root.children, children); assert.deepEqual(f.images(), [f.original]); assert.equal(f.timers.size, 0);
  assert.equal(createPageScene(null, { documentRef: f.documentRef, windowRef: f.windowRef }), null);
});
