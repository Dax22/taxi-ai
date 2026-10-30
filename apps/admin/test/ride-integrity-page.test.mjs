import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../public/', import.meta.url), modules = new Map();
async function moduleUrl(name) {
  if (modules.has(name)) return modules.get(name);
  let source = await readFile(new URL(name, root), 'utf8');
  for (const match of [...source.matchAll(/from\s+(['"])(.*?)\1/g)]) {
    const path = match[2], url = path.startsWith('/shared/')
      ? new URL('../../../packages/shared/src/' + path.slice(8), import.meta.url).href
      : await moduleUrl(path.replace(/^\.\//, ''));
    source = source.replace(match[0], "from '" + url + "'");
  }
  const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  modules.set(name, url); return url;
}
const pages = await import(await moduleUrl('ride-integrity-page.mjs'));

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.textContent = ''; }
  append(...values) { this.children.push(...values.map(v => typeof v === 'string' ? Object.assign(new Element('#text'), { textContent: v }) : v)); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
}
const flatten = node => [node, ...(node.children ?? []).flatMap(flatten)];
const text = node => flatten(node).map(item => item.textContent).join(' ');
function setup(t) {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag),
    createTextNode: value => Object.assign(new Element('#text'), { textContent: String(value) }) };
  t.after(() => { globalThis.document = previous; });
}

const id = '12345678-1234-4234-8234-123456789012';
const driverId = '23456789-1234-4234-8234-123456789012';
const rideId = '34567890-1234-4234-8234-123456789012';
const now = Date.UTC(2026, 0, 1);
const signal = { id, rideId, driverId, kind: 'tracking_gap_after_arrival', observedAt: now,
  arrivedAt: now - 120_000, lastLocationAt: now - 125_000,
  cancellationActorId: null, cancellationReason: null, reviewStatus: 'open', reviewNote: null,
  reviewedBy: null, reviewedAt: null, version: 1 };

test('queue shows review-only signals, safe links and cursor pagination', t => {
  setup(t);
  const route = { path: '/admin/ride-integrity', query: new URLSearchParams('state=open') };
  const page = pages.rideIntegrity({ items: [signal], notice: 'Not proof of misconduct.', nextBefore: `${now}:${id}` }, route);
  assert.match(text(page), /Not proof of misconduct/);
  assert.match(text(page), /Location sharing gap after arrival/);
  assert.ok(flatten(page).some(node => node.attributes.href === '/admin/ride-integrity/' + id));
  assert.ok(flatten(page).some(node => node.attributes.href === '/admin/transactions/ride/' + rideId));
  assert.ok(flatten(page).some(node => node.attributes.href === '/admin/people/' + driverId));
  assert.ok(flatten(page).some(node => node.attributes.href?.includes('state=open&before=')));
  assert.ok(!flatten(page).some(node => node.tag === 'script'));
});

test('detail never renders review controls without manage permission', t => {
  setup(t);
  const detail = { signal: { ...signal, kind: 'cancelled_after_arrival', lastLocationAt: null,
    cancellationReason: '<script>unsafe reason</script>' }, notice: 'Corroborate both parties.' };
  const page = pages.rideIntegrityDetail(detail, {}, { permissions: ['moderation.read'] });
  assert.match(text(page), /<script>unsafe reason<\/script>/);
  assert.match(text(page), /Corroborate both parties/);
  assert.equal(flatten(page).filter(node => node.tag === 'script').length, 0);
  assert.equal(flatten(page).filter(node => node.tag === 'form').length, 0);
});

test('authorized review form carries version and excludes the existing status', t => {
  setup(t);
  const page = pages.rideIntegrityDetail({ signal, notice: 'Staff review only.' }, {}, { permissions: ['moderation.read', 'moderation.manage'] });
  const form = flatten(page).find(node => node.tag === 'form');
  assert.ok(form);
  assert.equal(form.attributes['data-action'], `/api/admin/console/ride-integrity/${id}/review`);
  assert.deepEqual(form.actionData, { expectedVersion: 1 });
  assert.deepEqual(flatten(form).filter(node => node.tag === 'option').map(node => node.attributes.value), ['reviewed', 'dismissed']);
  assert.ok(flatten(form).some(node => node.tag === 'textarea' && node.attributes.maxlength === '500'));
});
