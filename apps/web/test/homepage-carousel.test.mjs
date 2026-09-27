import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomepageCarousel } from '../public/homepage-carousel.mjs';

class Element extends EventTarget {
  constructor() { super(); this.hidden = false; this.attributes = {}; this.textContent = ''; this.dataset = {}; }
  setAttribute(name, value) { this.attributes[name] = value; }
  emit(type, values = {}) { this.dispatchEvent(Object.assign(new Event(type), values)); }
}

function setup({ reduced = false, focused = false } = {}) {
  const root = new Element(), documentRef = new Element(), motion = new Element();
  const controls = new Element(), rotation = new Element(), previous = new Element(), next = new Element(), status = new Element();
  const names = ['City rides', 'Airport drop-off', 'Food delivery', 'Courier delivery'];
  const slides = names.map((name) => {
    const slide = new Element();
    slide.dataset.slideName = name;
    slide.image = { loading: 'lazy' };
    slide.querySelector = () => slide.image;
    return slide;
  });
  root.querySelectorAll = (selector) => selector === '[data-carousel-slide]' ? slides : [];
  const nodes = new Map([
    ['[data-carousel-controls]', controls], ['[data-carousel-rotation]', rotation],
    ['[data-carousel-previous]', previous], ['[data-carousel-next]', next], ['[data-carousel-status]', status],
  ]);
  root.querySelector = (selector) => nodes.get(selector);
  root.contains = (element) => element === rotation;
  root.matches = () => false;
  documentRef.activeElement = focused ? rotation : null;
  motion.matches = reduced;
  const timers = new Map(); let sequence = 0;
  const windowRef = {
    matchMedia: () => motion,
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const carousel = createHomepageCarousel(root, { documentRef, windowRef });
  return { root, documentRef, motion, controls, rotation, previous, next, status, slides, timers, carousel,
    active: () => slides.findIndex((slide) => !slide.hidden),
    tick() {
      assert.equal(timers.size, 1);
      const [id, timer] = [...timers][0]; timers.delete(id); timer.fn();
    },
  };
}

test('overlay navigation wraps and announces only the manually selected slide', () => {
  const f = setup();
  assert.equal(f.active(), 0);
  assert.equal(f.controls.hidden, false);
  assert.deepEqual(f.slides.map((slide) => slide.image.loading), ['eager', 'eager', 'lazy', 'lazy']);
  assert.equal(f.status.textContent, '');
  f.previous.emit('click');
  assert.equal(f.active(), 3);
  assert.equal(f.status.textContent, 'Courier delivery, slide 4 of 4.');
  assert.equal(f.timers.size, 0);
  f.next.emit('click');
  assert.equal(f.active(), 0);
  f.next.emit('click'); f.next.emit('click');
  assert.equal(f.active(), 2);
  assert.equal(f.status.textContent, 'Food delivery, slide 3 of 4.');
  assert.equal(f.slides.filter((slide) => !slide.hidden).length, 1);
});

test('automatic slides loop without interaction, continue on hover, and pause in a hidden document', () => {
  const f = setup();
  assert.equal([...f.timers.values()][0].delay, 7000);
  f.tick(); assert.equal(f.active(), 1);
  assert.equal(f.status.textContent, '');
  f.root.emit('pointerenter', { pointerType: 'mouse' });
  assert.equal(f.timers.size, 1);
  f.tick(); assert.equal(f.active(), 2);
  f.tick(); assert.equal(f.active(), 3);
  f.tick(); assert.equal(f.active(), 0);
  f.tick(); assert.equal(f.active(), 1);
  f.root.emit('pointerleave');
  assert.equal(f.timers.size, 1);
  f.documentRef.hidden = true; f.documentRef.emit('visibilitychange');
  assert.equal(f.timers.size, 0);
  f.documentRef.hidden = false; f.documentRef.emit('visibilitychange');
  assert.equal([...f.timers.values()][0].delay, 6500);
  assert.equal(f.active(), 1);
  f.tick(); assert.equal(f.active(), 2);
});

test('focus stops rotation until Play is explicitly activated; leaving or returning to the page never overrides it', () => {
  const f = setup();
  f.root.emit('focusin');
  assert.equal(f.timers.size, 0);
  assert.equal(f.rotation.attributes['aria-label'], 'Play slides automatically');
  f.root.emit('pointerleave');
  f.documentRef.emit('visibilitychange');
  assert.equal(f.timers.size, 0);
  f.rotation.emit('click', { detail: 0 });
  assert.equal(f.timers.size, 1);
  assert.equal(f.rotation.attributes['aria-label'], 'Pause slides');
  f.tick(); assert.equal(f.active(), 1);
  f.root.emit('focusin');
  assert.equal(f.timers.size, 0);
  assert.equal(setup({ focused: true }).timers.size, 0);
});

test('clicking Pause does not accidentally restart after the pointer focuses the button', () => {
  const f = setup();
  f.rotation.emit('pointerdown');
  f.root.emit('focusin');
  f.rotation.emit('click', { detail: 1 });
  assert.equal(f.timers.size, 0);
  assert.equal(f.rotation.attributes['aria-label'], 'Play slides automatically');
  f.rotation.emit('pointerdown');
  f.rotation.emit('click', { detail: 1 });
  assert.equal(f.timers.size, 1);
});

test('reduced motion allows manual navigation only, including when the preference changes during playback', () => {
  const f = setup({ reduced: true });
  assert.equal(f.rotation.disabled, true);
  assert.equal(f.timers.size, 0);
  f.rotation.emit('click', { detail: 0 });
  assert.equal(f.timers.size, 0);
  f.next.emit('click'); assert.equal(f.active(), 1);
  f.motion.matches = false; f.motion.emit('change');
  assert.equal(f.rotation.disabled, false);
  assert.equal(f.timers.size, 0);
  f.rotation.emit('click', { detail: 0 });
  assert.equal(f.timers.size, 1);
  f.motion.matches = true; f.motion.emit('change');
  assert.equal(f.timers.size, 0);
  f.root.emit('pointerleave');
  assert.equal(f.timers.size, 0);
});

test('cleanup removes timers and listeners and restores the original city scene', () => {
  const f = setup();
  f.tick(); assert.equal(f.active(), 1);
  f.carousel.destroy();
  assert.equal(f.timers.size, 0);
  assert.equal(f.active(), 0);
  assert.equal(f.controls.hidden, true);
  f.next.emit('click'); f.rotation.emit('click'); f.documentRef.emit('visibilitychange');
  assert.equal(f.active(), 0);
  assert.equal(f.timers.size, 0);
  assert.equal(createHomepageCarousel(null), null);
});
