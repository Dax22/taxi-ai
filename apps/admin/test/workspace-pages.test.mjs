import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../public/', import.meta.url), modules = new Map();
async function moduleUrl(name) {
  if (modules.has(name)) return modules.get(name);
  let source = await readFile(new URL(name, root), 'utf8');
  for (const [, specifier] of source.matchAll(/from\s+'([^']+)'/g)) {
    const url = specifier.startsWith('/shared/') ? new URL('../../../packages/shared/src/' + specifier.slice(8), import.meta.url).href : await moduleUrl(specifier.slice(2));
    source = source.replace(`'${specifier}'`, `'${url}'`);
  }
  const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64'); modules.set(name, url); return url;
}
const { renderPage } = await import(await moduleUrl('pages.mjs'));
const { createAdminView } = await import(await moduleUrl('view.mjs'));
const { formPayload } = await import(await moduleUrl('forms.mjs'));
const html = await readFile(new URL('index.html', root), 'utf8');
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.textContent = ''; this.value = ''; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = value; if (key.startsWith('data-')) this.dataset[key.slice(5)] = value; }
  getAttribute(key) { return this.attributes[key]; }
  removeAttribute(key) { delete this.attributes[key]; }
  replaceWith(node) { const index = this.parent.children.indexOf(this); this.parent.children.splice(index, 1, node); node.parent = this.parent; }
  querySelectorAll(query) { return all(this).filter((node) => query.startsWith('a[') && node.tag === 'a' && node.attributes.href?.startsWith('/admin')); }
  querySelector() { return null; }
  set innerHTML(value) { throw new Error('Unsafe HTML assignment: ' + value); }
}
const all = (node) => [node, ...node.children.flatMap(all)];
const text = (node) => all(node).map((item) => item.textContent).join(' ');
function fixture(t) {
  const old = globalThis.document, nodes = new Map();
  for (const [, tag, id] of html.matchAll(/<(\w+)\b[^>]*?\bid="([^"]+)"/g)) nodes.set(id, new Node(tag));
  const nav = ['overview', 'accounts', 'trips', 'analytics', 'operations', 'cases', 'staff', 'audit'].map((section) => { const node = new Node('a'); node.dataset.section = section; return node; });
  globalThis.document = { getElementById: (id) => nodes.get(id), createElement: (tag) => new Node(tag), createElementNS: (ns, tag) => new Node(tag),
    createTextNode: (value) => { const node = new Node('#text'); node.textContent = value; return node; }, querySelectorAll: () => nav };
  t.after(() => { globalThis.document = old; }); return { nodes, nav };
}
const id = '11111111-1111-4111-8111-111111111111', now = 1790000000000;
const route = (name) => ({ name, section: name, path: '/admin/' + name, query: new URLSearchParams(), title: name, description: 'Workspace' });
const access = { role: 'support', permissions: ['cases.support', 'accounts.read', 'trips.read'] };
const item = { id, rideId: id, category: 'support', subject: '<script>private report</script>', description: 'Help with a journey', status: 'open', priority: 'normal', assignedTo: null,
  version: 7, createdAt: now, updatedAt: now, responseDueAt: now - 100, firstRespondedAt: null, resolvedAt: null };

test('operations queues use snapshot facts, clear missing location and preserve cursor filters', (t) => {
  fixture(t);
  for (const queue of ['waiting', 'active', 'drivers', 'eats']) {
    const row = { id, status: 'requested', region: { key: 'cell:1', label: 'cell:1' }, driverName: 'Driver A', vehicleCategory: 'standard', waitSeconds: 61,
      expiresAt: now, pendingOffer: true, location: { status: 'unavailable', capturedAt: null }, mode: 'online', lastSeenAt: now, leaseExpiresAt: now, storeName: 'Kitchen A', delaySeconds: 30 };
    const data = { asOf: now, counts: { waitingRequests: 1, activeTrips: 2, availableDrivers: 3, delayedEats: 4 },
      matching: { since: now, until: now, pending: 1, expired: 0, declined: 0, accepted: 2, matchedRequests: 2, meanMatchSeconds: 61 },
      filters: { queue }, queues: { [queue]: { items: [row], nextCursor: '123.' + id } } };
    const output = renderPage(route('operations'), data, { permissions: ['operations.read'] });
    assert.match(text(output), /stage review threshold/); assert.match(text(output), /30 seconds while visible/);
    assert.doesNotMatch(text(output), /undefined|NaN|cell:1 \(cell:1\)/);
    assert.equal(all(output).filter((node) => node.tag === 'a' && node.attributes.href.startsWith('/admin/trips/')).length, 0);
    assert.ok(all(output).some((node) => node.attributes.href?.includes('queue=' + queue + '&after=')));
    if (queue === 'active') assert.match(text(output), /No shared location/);
  }
});
test('case creation and actions use allowed categories, plain text and numeric record versions', (t) => {
  fixture(t);
  const output = renderPage(route('cases'), { cases: [item], permissions: { support: true, safety: false }, page: { next: null }, serverNow: now }, access);
  assert.match(text(output), /<script>private report<\/script>/); assert.equal(all(output).filter((node) => node.tag === 'script').length, 0);
  assert.equal(all(output).filter((node) => node.tag === 'option' && node.attributes.value === 'safety').length, 0); assert.match(text(output), /Overdue/);
  const detail = renderPage(route('case'), { case: { ...item, capabilities: { canManage: true }, trip: null }, events: [], eligibleStaff: [], page: { next: null }, serverNow: now }, access);
  const forms = all(detail).filter((node) => node.tag === 'form');
  assert.equal(forms.length, 4); assert.ok(forms.every((form) => form.actionData.expectedVersion === 7));
  assert.equal(all(forms.find((form) => form.dataset.action.endsWith('/status'))).filter((node) => node.tag === 'option' && node.attributes.value === 'open').length, 0);
  const payload = formPayload({ actionData: { expectedVersion: 7 }, elements: [{ name: 'assigneeId', value: '' }, { name: 'reason', value: 'Team assignment' }] });
  assert.deepEqual(payload, { expectedVersion: 7, assigneeId: null, reason: 'Team assignment' });
});
test('resolved cases can only reopen, and recorded incident evidence never claims live tracking', (t) => {
  fixture(t);
  const detail = renderPage(route('case'), { case: { ...item, category: 'safety', status: 'resolved', capabilities: { canManage: true }, trip: null,
    incident: { kind: 'sos', status: 'resolved', recordedAt: now, location: { lat: 9.01, lng: 7.4, capturedAt: now, source: 'saved_incident_snapshot', stale: true }, notifications: [{ status: 'sent', mode: 'simulation', attempts: 1, updatedAt: now }] } },
    events: [], eligibleStaff: [], page: { next: null }, serverNow: now }, { permissions: ['cases.safety'] });
  assert.match(text(detail), /not a live location feed/); assert.match(text(detail), /not proof/); assert.match(text(detail), /simulation/);
  const status = all(detail).find((node) => node.tag === 'form' && node.dataset.action.endsWith('/status'));
  assert.deepEqual(all(status).filter((node) => node.tag === 'option').map((node) => node.attributes.value), ['', 'open']);
});
test('staff UI omits owner assignment for regular accounts and includes audited reasons', (t) => {
  fixture(t);
  const output = renderPage(route('staff'), { items: [{ userId: id, email: 'support@example.test', name: 'Support A', role: 'support', status: 'active', version: 3, mfaEnrolled: true, updatedAt: now, ownerEligible: false }],
    roles: [{ id: 'owner', label: 'Owner', permissions: ['staff.manage'], assignable: false }, { id: 'support', label: 'Support', permissions: ['cases.support'], assignable: true }] });
  assert.equal(all(output).filter((node) => node.tag === 'option' && node.attributes.value === 'owner').length, 0);
  const forms = all(output).filter((node) => node.tag === 'form');
  assert.equal(forms.length, 4); assert.ok(forms.every((form) => all(form).some((node) => node.attributes.name === 'reason' && node.attributes.required === '')));
  assert.equal(forms[0].actionData.expectedVersion, 0); assert.equal(forms[1].actionData.expectedVersion, 3);
});
test('view hides unauthorized navigation and removes MFA setup keys on concealment', (t) => {
  const f = fixture(t), view = createAdminView();
  view.render(route('cases'), { cases: [], permissions: { support: true, safety: false }, page: { next: null }, serverNow: now }, { name: 'Operator' }, access);
  assert.deepEqual(f.nav.filter((node) => !node.hidden).map((node) => node.dataset.section), ['accounts', 'trips', 'cases']);
  assert.equal(f.nodes.get('legacy-review').hidden, true);
  view.mfa({ available: true, enrolled: false }, { secret: 'PRIVATE-SETUP-KEY', expiresAt: now }); assert.match(text(f.nodes.get('mfa-content')), /PRIVATE-SETUP-KEY/);
  view.clear(); assert.equal(text(f.nodes.get('mfa-content')), ''); assert.ok(f.nav.every((node) => node.hidden));
});
