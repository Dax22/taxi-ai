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
const { money } = await import(await moduleUrl('ui.mjs'));
const html = await readFile(new URL('index.html', root), 'utf8');
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.textContent = ''; this.value = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  querySelectorAll() { return []; }
  removeAttribute(key) { delete this.attributes[key]; }
  set innerHTML(value) { throw new Error('Private strings must not be rendered as HTML: ' + value); }
}
const all = (node) => [node, ...node.children.flatMap(all)];
const text = (node) => all(node).map((item) => item.textContent).join(' ');
function fixture(t) {
  const old = globalThis.document, oldWindow = globalThis.window, nodes = new Map();
  for (const [, tag, id] of html.matchAll(/<(\w+)\b[^>]*?\bid="([^"]+)"/g)) nodes.set(id, new Node(tag));
  const nav = ['overview', 'accounts', 'trips', 'analytics'].map((section) => { const item = new Node('a'); item.dataset.section = section; item.attributes.href = section === 'overview' ? '/admin' : '/admin/' + section; return item; });
  globalThis.document = { getElementById(id) { assert.ok(nodes.has(id), id); return nodes.get(id); }, createElement: (tag) => new Node(tag),
    createElementNS: (space, tag) => new Node(tag), createTextNode: (value) => { const node = new Node('#text'); node.textContent = value; return node; }, querySelectorAll: (selector) => selector === '#navigation a' ? nav : [] };
  globalThis.window = { location: { origin: 'https://taxiai.app' } };
  t.after(() => { globalThis.document = old; globalThis.window = oldWindow; }); return { nodes, nav };
}
const id = '11111111-1111-4111-8111-111111111111', now = Date.UTC(2026, 8, 20);
const summary = { requests: 3, completed: 2, cancelled: 1, expired: 0, active: 0, completionRate: 2 / 3, cancellationRate: 1 / 3,
  completedFareKobo: '970100', simulatedPaidKobo: '470001', outstandingKobo: '500099', averageFareKobo: '485050', failed: 0, pending: 0 };
const trip = { id, createdAt: now, updatedAt: now, completedAt: now, status: 'completed', customer: { id, name: '<img src=x onerror=alert(1)>' },
  driver: { id, name: 'Fictional driver' }, pickup: 'Wuse II', destination: 'Maitama', fareKobo: '470001', paymentStatus: 'paid', paymentMode: 'simulation' };
const range = { from: '2026-09-19', to: '2026-09-20' }, page = { limit: 25, next: now + '.' + id, previous: null };
const accounts = { total: 3, customerOnly: 2, drivers: 1, newAccounts: 2, awaitingReview: 1 };
const analytics = { summary, range, accounts, daily: [{ date: range.from, ...summary }, { date: range.to, ...summary }],
  statuses: [{ status: 'completed', count: 2 }, { status: 'cancelled', count: 1 }], routes: [{ pickup: 'Wuse II', destination: 'Maitama', requests: 3, completed: 2 }], recentTrips: [trip] };
function route(name, path = '/admin/' + name) { return { name, path, query: new URLSearchParams(''), title: name, description: 'Test page', section: name }; }

test('overview, analytics and direct trip pages render real values and labelled simulated payments without interpreting user strings', (t) => {
  fixture(t);
  for (const name of ['overview', 'analytics']) {
    const output = renderPage(route(name), analytics);
    assert.match(text(output), /₦9,701\.00/); assert.match(text(output), /simulated/);
    assert.ok(all(output).some((node) => node.tag === 'svg' && node.attributes.role === 'img'));
    assert.ok(all(output).some((node) => node.tag === 'details'));
  }
  const output = renderPage(route('trip'), { trip, activity: [{ type: 'completed', createdAt: now, actorName: 'Fictional driver' }] });
  assert.match(text(output), /<img src=x onerror=alert\(1\)>/); assert.equal(all(output).filter((node) => node.tag === 'img').length, 0);
  assert.ok(all(output).some((node) => node.attributes.href === '/admin/accounts/' + id));
  assert.match(text(output), /₦4,700\.01/);
});
test('account drilldown separates passenger spending from driving fares, uses colour artwork and preserves filters across history pages', (t) => {
  fixture(t);
  const current = route('account', '/admin/accounts/' + id); current.query = new URLSearchParams('mode=driver&payment=paid');
  const output = renderPage(current, { account: { id, name: 'Fictional driver', email: 'driver@example.test', type: 'driver', createdAt: now,
    reviewStatus: 'approved', vehicle: { make: 'Honda', model: 'Civic', year: 2020, colour: 'Blue', plate: 'TEST-123' } },
  summary, passenger: { ...summary, completedFareKobo: '600001' }, driving: summary, trips: { items: [trip], page } });
  assert.match(text(output), /₦6,000\.01/); assert.match(text(output), /₦9,701\.00/); assert.match(text(output), /all time/);
  assert.ok(all(output).some((node) => node.attributes.src === '/assets/vehicles/sedan-blue.png'));
  const next = all(output).find((node) => node.textContent === 'Next →');
  assert.match(next.attributes.href, /mode=driver&payment=paid&before=/);
  assert.equal(all(output).find((node) => node.attributes.name === 'mode').value, 'driver');
});
test('directory empty states are explicit, exact money stays precise and resetting the view removes private content', (t) => {
  const f = fixture(t);
  const output = renderPage(route('accounts'), { items: [], page: { next: null, previous: null }, counts: { total: 0, drivers: 0, customerOnly: 0, awaitingReview: 0 } });
  assert.match(text(output), /No matching accounts/);
  assert.equal(money('18014398509481982'), '₦180,143,985,094,819.82');
  const view = createAdminView(); view.render(route('overview', '/admin'), { ...analytics, serverNow: now }, { name: 'Private staff name' }, { role: 'owner', permissions: ['analytics.read'] });
  assert.equal(f.nodes.get('workspace').hidden, false); assert.equal(f.nav[0].attributes['aria-current'], 'page');
  view.clear(); assert.equal(f.nodes.get('workspace').hidden, true); assert.equal(f.nodes.get('page-content').children.length, 0);
  assert.equal(f.nodes.get('staff-name').textContent, ''); view.signIn('Sign in'); assert.equal(f.nodes.get('sign-in').hidden, false);
});

test('finance overview and analytics show aggregate totals without treating permission-redacted journeys as no activity', (t) => {
  fixture(t);
  for (const name of ['overview', 'analytics']) {
    const output = renderPage(route(name), { ...analytics, recentTrips: [], routes: [] }, { role: 'finance', permissions: ['analytics.read'] });
    assert.match(text(output), /₦9,701\.00/); assert.match(text(output), /aggregate totals/); assert.match(text(output), /require trip access/);
    assert.doesNotMatch(text(output), /No journeys to show|No route activity yet|Recent journeys|Most requested routes/);
    assert.equal(all(output).filter((node) => node.attributes.href?.startsWith('/admin/trips')).length, 0);
    assert.equal(all(output).filter((node) => node.attributes.href?.startsWith('/admin/accounts')).length, 0);
  }
});

test('Mobile Operations renders build, push, tracking and API health without secret token material', (t) => {
  fixture(t);
  const mobileData = { serverNow: now, filters: { window: '24h', platform: 'all', since: now - 86_400_000 }, canManage: false, sampleEvery: 20,
    policy: { ios: { minimumBuild: null, minimumVersion: null }, android: { minimumBuild: 12, minimumVersion: '0.9.0' } },
    summary: { activeDevices: 2, reportingDevices: 2, iosDevices: 1, androidDevices: 1, unknownBuildDevices: 0, pushRegistered: 1, knownDevices: 2, latestBuildDevices: 2, latestAdoption: 1, unsupportedDevices: 0 },
    latestBuilds: { ios: 9, android: 14 }, builds: [{ platform: 'android', appVersion: '0.9.0', nativeBuild: 14, buildProfile: 'acceptance', devices: 1, lastSeenAt: now, easBuildId: id, gitCommit: 'a'.repeat(40) }],
    push: { registered: 1, jobs: { done: { count: 3, attempts: 3 }, dead: { count: 1, attempts: 2 } } },
    tracking: { ride: { active: 1, healthy: 1, stale: 0, expired: 0 }, food: { active: 0, healthy: 0, stale: 0, expired: 0 }, backgroundGrants: 1 },
    api: { estimatedRequests: 101, clientErrors: 2, serverErrors: 1, errorRate: 3 / 101, p50: 80, p95: 210, samples: 8, byRoute: [{ route: 'booking', requests: 50, errors: 1, errorRate: .02, p95: 190 }] },
    devices: [{ sessionId: id, deviceName: 'Fictional Android', userId: id, userName: 'Fictional rider', email: 'rider@example.test', platform: 'android', appVersion: '0.9.0', nativeBuild: 14, easBuildId: id, buildProfile: 'acceptance', gitCommit: 'a'.repeat(40), osVersion: '15', locationPermission: 'granted', backgroundLocationPermission: 'granted', notificationPermission: 'denied', lastSeenAt: now, refreshedAt: now, pushRegistered: true, driverOnline: false, supported: true }], limits: { deviceRows: 500, apiSamples: 5000 } };
  const output = renderPage(route('mobile'), mobileData, { role: 'operations', permissions: ['mobile.read'] }), content = text(output);
  assert.match(content, /Active native sessions/); assert.match(content, /1 iOS · 1 Android/); assert.match(content, /Mobile API reliability/); assert.match(content, /Ride shares/); assert.match(content, /0\.9\.0/);
  assert.doesNotMatch(content, /ExponentPushToken|refreshToken|accessToken|latitude|longitude/);
});
