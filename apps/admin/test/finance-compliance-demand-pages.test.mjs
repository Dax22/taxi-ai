import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeFor, defaultPage } from '../public/navigation.mjs';
import { createAdminController } from '../public/controller.mjs';

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
  setAttribute(key, value) { this.attributes[key] = String(value); if (key.startsWith('data-')) this.dataset[key.slice(5)] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  removeAttribute(key) { delete this.attributes[key]; }
  replaceWith(node) { const index = this.parent.children.indexOf(this); this.parent.children.splice(index, 1, node); node.parent = this.parent; }
  querySelectorAll(query) { return all(this).filter((node) => query.startsWith('a[') && node.tag === 'a' && node.attributes.href?.startsWith('/admin')); }
  querySelector() { return null; }
  get elements() { return all(this).filter((node) => ['input', 'select', 'textarea'].includes(node.tag)).map((node) => ({ name: node.attributes.name, value: node.value, dataset: node.dataset })); }
  addEventListener(type,handler) { this.handlers??={};this.handlers[type]=handler; }
  set innerHTML(value) { throw new Error('Unsafe HTML assignment: ' + value); }
}
const all = (node) => [node, ...node.children.flatMap(all)];
const text = (node) => all(node).map((item) => item.textContent).join(' ').replace(/\s+/g, ' ');
function fixture(t) {
  const old = globalThis.document, nodes = new Map();
  for (const [, tag, id] of html.matchAll(/<(\w+)\b[^>]*?\bid="([^"]+)"/g)) nodes.set(id, new Node(tag));
  const nav = [...html.matchAll(/data-section="([^"]+)"/g)].map(([, section]) => { const node = new Node('a'); node.dataset.section = section; return node; });
  globalThis.document = { getElementById: (id) => nodes.get(id), createElement: (tag) => new Node(tag), createElementNS: (ns, tag) => new Node(tag),
    createTextNode: (value) => { const node = new Node('#text'); node.textContent = value; return node; }, querySelectorAll: () => nav };
  t.after(() => { globalThis.document = old; }); return { nodes, nav };
}
const id = '11111111-1111-4111-8111-111111111111', now = Date.parse('2026-09-25T10:00:00Z');
const route = (name, query = '') => routeFor({ pathname: '/admin/' + name, search: query });
const payment = { rideId: id, amountKobo: '900719925474099300', currency: 'NGN', mode: 'simulation', status: 'paid', completedAt: now, updatedAt: now, paidAt: now,
  currentReference: 'SIM-11111111-1111-4111-8111-111111111111', findings: [{ code: 'receipt_mismatch', label: '<script>Receipt mismatch</script>' }] };
const financeData = () => ({ viewerId: id, asOf: now, paymentMode: 'simulation', provider: 'not_configured', scope: { from: '2026-09-01', to: '2026-09-25' },
  filters: { from: '2026-09-01', to: '2026-09-25', status: 'all', q: '' },
  summary: { completedTrips: 7, grossFareKobo: payment.amountKobo, simulatedPaidKobo: payment.amountKobo, outstandingKobo: '0', paidTrips: 1, unpaidTrips: 4, pendingTrips: 1, failedTrips: 1, attentionTrips: 2,
    feesKobo: null, commissionKobo: null, refundsKobo: null, payoutsKobo: null }, payments: [payment], page: { limit: 1, next: now + '.' + id } });
const driver = { id, name: '<img src=x onerror=alert(1)>', vehicle: { model: 'Sedan', plate: 'ABJ 123' }, applicationStatus: 'approved', updatedAt: now,
  eligibility: { eligible: false, missing: ['profile_photo'], expired: ['driving_licence'], validUntil: now }, expiring: ['insurance'],
  followUp: { version: 3, status: 'open', dueAt: now - 1000, note: 'Contact driver about licence', updatedAt: now, completedAt: null, actor: { id, name: 'Operator' }, overdue: true, applicationChanged: true }, capabilities: { canManage: true } };
const complianceData = () => ({ viewerId: id, serverNow: now, followUpMode: 'internal', filters: { queue: 'expired', followUp: 'open', q: '' },
  summary: { all: 5, submitted: 1, expiring: 2, expired: 1, missing: 3, eligible: 1, openFollowUps: 2, overdueFollowUps: 1 }, drivers: [driver], page: { next: id, limit: 1 } });
const complianceDetail = () => ({ viewerId: id, serverNow: now, driver,
  documents: [{ kind: 'driving_licence', label: 'Driving licence', expiresOn: '2026-09-24', state: 'expired', deadline: now }], review: null, applicationHistory: [], events: [], page: { next: now + '.' + id, limit: 1 } });
const demandData = () => ({ viewerId: id, asOf: now, filters: { from: '2026-09-25', to: '2026-09-25', service: 'all', region: '' },
  totals: { requests: 8, matched: 4, completed: 2, unserved: 1, cancelled: 1, open: 4, meanMatchSeconds: 30, matchedWithTiming: 3 },
  daily: [{ date: '2026-09-25', requests: 8, matched: 4, completed: 2, unserved: 1, cancelled: 1 }],
  hours: Array.from({ length: 24 }, (_, hour) => ({ hour, requests: hour === 11 ? 8 : 0, matched: hour === 11 ? 4 : 0 })),
  offers: { accepted: 4, declined: 2, expired: 2, pending: 5, revoked: 1, acceptanceRate: 0.5, resolvedForAcceptance: 8 },
  supply: { capturedAt: now, availableDrivers: 2, scope: 'current', serviceFilterApplied: true },
  areas: { limit: 1, truncated: true, items: [{ region: { key: 'ng:12:20', label: 'Dispatch cell 12:20', kind: 'dispatch_cell' }, requests: 6, matched: 3, unserved: 1, meanMatchSeconds: 20, availableDrivers: 1 }] } });

test('finance displays exact simulation totals and keeps unavailable money and sensitive journey details out', (t) => {
  fixture(t); const output = renderPage(route('finance', '?status=paid&from=2026-09-01&to=2026-09-25'), financeData(), { permissions: ['finance.read'] }), rendered = text(output);
  assert.match(rendered, /₦9,007,199,254,740,993\.00/); assert.match(rendered, /7 completed journeys/);
  assert.match(rendered, /Paystack is not configured/); assert.match(rendered, /does not reconcile a bank/); assert.match(rendered, /Eats payments are not included/);
  assert.match(rendered, /Gateway fees Unavailable/); assert.match(rendered, /Taxi Ai commission Unavailable/);
  assert.match(rendered, /<script>Receipt mismatch<\/script>/); assert.equal(all(output).some((node) => node.tag === 'script'), false);
  assert.equal(all(output).some((node) => node.attributes.href?.includes('/admin/trips/')), false);
  assert.equal(all(output).some((node) => node.tag === 'button' && /refund|pay|export/i.test(node.textContent)), false);
  assert.ok(all(output).some((node) => node.attributes.href?.includes('status=paid&from=2026-09-01&to=2026-09-25&before=')));
  assert.doesNotMatch(rendered, /NaN|undefined/);
});
test('inconsistent receipt metadata is withheld while bounded attempt history remains readable', (t) => {
  fixture(t); const output = renderPage(route('finance/' + id), { payment, findings: payment.findings,
    receipt: { available: true, consistent: false, number: 'DO-NOT-DISPLAY', amountKobo: '77700' },
    attempts: [{ id, reference: payment.currentReference, amountKobo: '50000', provider: 'simulator', status: 'failed', createdAt: now, resolvedAt: now }], page: { next: now + '.' + id } });
  assert.match(text(output), /saved receipt does not match/); assert.doesNotMatch(text(output), /DO-NOT-DISPLAY|777/);
  assert.match(text(output), /₦500\.00/); assert.match(text(output), /simulator/);
  assert.ok(all(output).some((node) => node.attributes.href?.startsWith('/admin/finance/' + id + '?before=')));
});
test('compliance queue explains overlapping totals and safely presents canonical document labels', (t) => {
  fixture(t); const output = renderPage(route('compliance', '?queue=expired&followUp=open'), complianceData());
  assert.match(text(output), /Summary counts use the driver search across all queues/); assert.match(text(output), /next 30 days/);
  assert.match(text(output), /Driving licence/); assert.match(text(output), /Driver photo/); assert.match(text(output), /Overdue/);
  assert.equal(all(output).some((node) => node.tag === 'img'), false);
  assert.ok(all(output).some((node) => node.attributes.href?.includes('queue=expired&followUp=open&after=')));
  assert.doesNotMatch(text(output), /NaN|undefined/);
});
test('compliance actions retain numeric versions and convert explicitly entered WAT deadlines independently of the browser timezone', (t) => {
  fixture(t); const data = complianceDetail(), output = renderPage(route('compliance/' + id), data, { permissions: ['compliance.read', 'compliance.manage'] });
  assert.match(text(output), /Application changed since this follow-up/); assert.match(text(output), /does not send an email/); assert.match(text(output), /does not approve an application/);
  const forms = all(output).filter((node) => node.tag === 'form'); assert.equal(forms.length, 2);
  const schedule = forms.find((form) => form.dataset.action.endsWith('/follow-up'));
  all(schedule).find((node) => node.attributes.name === 'dueAt').value = '2026-09-26T10:30';
  all(schedule).find((node) => node.attributes.name === 'note').value = 'Review renewed insurance';
  assert.deepEqual(formPayload(schedule), { expectedVersion: 3, dueAt: Date.parse('2026-09-26T09:30:00Z'), note: 'Review renewed insurance' });
  const readOnly = renderPage(route('compliance/' + id), data, { permissions: ['compliance.read'] });
  assert.equal(all(readOnly).some((node) => node.tag === 'form'), false);
  assert.equal(all(readOnly).some((node) => node.attributes.href === '/app'), false);
  const finished = renderPage(route('compliance/' + id), { ...data, driver: { ...driver, followUp: { ...driver.followUp, status: 'done' } } }, { permissions: ['compliance.read', 'compliance.manage'] });
  assert.equal(all(finished).filter((node) => node.tag === 'form').length, 1);
});
test('demand renders measured request cohorts, WAT heat values, denominator definitions and current supply without a shortage ratio', (t) => {
  fixture(t); const output = renderPage(route('demand'), demandData()), rendered = text(output);
  assert.match(rendered, /50% of all selected requests/); assert.match(rendered, /3 matched requests with valid timing/);
  assert.match(rendered, /accepted ÷ \(accepted \+ declined \+ expired\)/); assert.match(rendered, /Responses in denominator 8/);
  assert.match(rendered, /This is not historical driver supply/); assert.match(rendered, /including rows not shown here/); assert.match(rendered, /Coarse GPS area/);
  const cells = all(output).filter((node) => node.tag === 'li' && node.className?.startsWith('demand-hour'));
  assert.equal(cells.length, 24); assert.match(text(cells[11]), /11:00 8 4 matched/); assert.match(cells[11].className, /density-4/); assert.match(cells[0].className, /density-0/);
  assert.ok(all(output).some((node) => node.attributes.href?.includes('from=2026-09-25&to=2026-09-25&service=all&region=ng%3A12%3A20')));
  assert.doesNotMatch(rendered, /NaN|undefined|Infinity/);
});
test('new pages keep scoped navigation and finance landing while denied pages never fetch protected data', async (t) => {
  const f = fixture(t), view = createAdminView(), access = { role: 'finance', permissions: ['finance.read', 'analytics.read'] };
  view.render(route('finance'), financeData(), { name: 'Finance A' }, access);
  assert.deepEqual(f.nav.filter((node) => !node.hidden).map((node) => node.dataset.section), ['insights', 'analytics', 'finance']);
  assert.equal(defaultPage(access), '/admin/finance'); assert.equal(f.nodes.get('legacy-review').hidden, true);
  assert.equal(route('finance/' + id).permission, 'finance.read'); assert.equal(route('compliance/' + id).permission, 'compliance.read'); assert.equal(route('demand').permission, 'demand.read');
  assert.throws(() => route('demand/' + id));
  const paths = [], errors = [], session = { user: { id }, csrfToken: 'token', staff: access }, client = { session: async () => session, setCsrf() {}, reset() {}, request: async (path) => { paths.push(path); return {}; } };
  const controllerView = { clear() {}, loading() {}, signIn: (value) => errors.push(value), render() {}, error() {} }, navigated = [];
  await createAdminController({ client, view: controllerView, route: routeFor({ pathname: '/admin', search: '' }), navigate: (path) => navigated.push(path) }).load();
  assert.deepEqual(navigated, ['/admin/finance']); assert.equal(paths.length, 0);
  await createAdminController({ client, view: controllerView, route: route('compliance') }).load();
  assert.equal(paths.length, 0); assert.match(errors.at(-1), /does not have access/);
});

test('unified views preserve whole-cohort summaries, actionable links and explicit payment modes',t=>{
 fixture(t);const item={id,service:'food',status:'placed',createdAt:now,updatedAt:now,customer:{id,name:'<script>buyer</script>'},worker:null,store:{id,name:'Kitchen'},pickup:'Kitchen',destination:'Maitama',amountKobo:'625000',paymentMode:'test',paymentStatus:'not_charged'};
 const data={items:[item],nextBefore:null,summary:{total:3,groups:[{service:'food',paymentMode:'test',transactions:3,completed:1,cancelled:0,active:2,amountKobo:'1875000',unknownAmounts:0}],basis:'Source amounts, not revenue.'}};
 const output=renderPage(route('transactions'),data,{permissions:['transactions.read','transactions.export']});
 assert.match(text(output),/All matching transactions/);assert.match(text(output),/not_charged/);
 assert.match(text(output),/<script>buyer<\/script>/);assert.equal(all(output).some(n=>n.tag==='script'),false);
 assert.ok(all(output).some(n=>n.attributes.href==='/admin/transactions/food/'+id));
 assert.ok(all(output).some(n=>n.attributes.href?.startsWith('/admin/transactions-export')));
});
test('moderation impact forms preserve versioned scope and never offer account session revocation during active work',t=>{
 fixture(t);const output=renderPage(route('restriction-impact'),{asOf:now,subject:{id,name:'Test worker'},subjectType:'account',allowedScopes:['customer','driver','account'],impact:{activeJourneys:1,activeFoodOrders:0,total:1,policy:'Active jobs require supervised resolution.'}},{permissions:['moderation.manage']});
 const form=all(output).find(n=>n.tag==='form');assert.equal(form.dataset.action,'/api/admin/console/restrictions');
 const scopes=all(form).filter(n=>n.tag==='option').map(n=>n.attributes.value);
 assert.ok(scopes.includes('driver'));assert.ok(!scopes.includes('account'));
 const review=all(form).find(n=>n.attributes.name==='reviewAt');review.value='2026-09-26T10:30';
 const expiry=all(form).find(n=>n.attributes.name==='expiresAt');expiry.value='';
 assert.equal(formPayload(form).reviewAt,Date.parse('2026-09-26T09:30:00Z'));assert.equal(formPayload(form).expiresAt,null);
 assert.match(text(output),/Existing|existing/);
});
test('typed admin detail routes reject arbitrary resource paths and use explicit permissions',()=>{
 assert.equal(route('transactions/food/'+id).name,'transactionDetail');
 assert.equal(route('live/courier/'+id).permission,'operations.location');
 assert.equal(route('restrictions/'+id).permission,'moderation.read');
 assert.throws(()=>route('live'));assert.throws(()=>route('transactions/unknown/'+id));assert.throws(()=>route('platform/'+id));
});
