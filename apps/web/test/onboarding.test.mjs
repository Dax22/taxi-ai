import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createOnboardingController } from '../public/dashboard/onboarding-controller.mjs';

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { resolve, promise }; };
const driver = { id: 'driver', role: 'driver' }, admin = { id: 'admin', role: 'admin' };
const application = { driverId: 'driver', name: '<Driver name>', version: 7, status: 'draft', details: {
  legalName: '<Private legal name>', phone: '+2348000000000', licenceNumber: 'PRIVATE-LICENCE',
  vehicle: { make: 'Toyota', model: 'Corolla', year: 2020, colour: 'Yellow', plate: 'TEST-123' } },
  documents: [{ id: 'doc', kind: 'profile_photo', name: 'private.png', sizeBytes: 50 }],
  eligibility: { eligible: false, missing: ['insurance'], expired: [] }, events: [], busy: false };
function controller() {
  const f = { commands: [], saved: [], views: [], resets: 0, accepted: 0 };
  f.client = { request: async () => ({ application }), command: async (path, data) => { f.commands.push({ path, data }); return { application: { ...application, version: 8 } }; } };
  f.files = { read: async () => ({ name: 'image.png', mimeType: 'image/png', base64: 'fixture' }), save: (value) => f.saved.push(value) };
  f.c = createOnboardingController({ client: f.client, files: f.files, view: { render: (value) => f.views.push(structuredClone(value)),
    reset() { f.resets++; }, acceptChanges() { f.accepted++; }, focus() {} } });
  return f;
}

test('private application reads and document downloads are discarded after account switch, close or reset', async () => {
  const f = controller(), first = deferred(); f.client.request = () => first.promise;
  f.c.context(driver); const load = f.c.poll(); f.c.context({ id: 'other', role: 'driver' });
  first.resolve({ application }); await load;
  assert.equal(f.views.at(-1).application, null);
  f.client.request = async () => ({ application }); f.c.context(admin); await f.c.open('driver');
  const download = deferred(); f.client.request = () => download.promise;
  const task = f.c.download('doc'); f.c.close(); download.resolve({ document: {}, base64: 'private' }); await task;
  assert.deepEqual(f.saved, []); assert.equal(f.views.at(-1).application, null);
  f.c.reset(); assert.equal(f.views.at(-1).user, null);
});

test('late file reads cannot upload into a replacement account and duplicate clicks send one exact version', async () => {
  const f = controller(); f.c.context(driver); await f.c.poll();
  const read = deferred(); f.files.read = () => read.promise;
  const upload = f.c.run('upload', { expectedVersion: 7, kind: 'profile_photo', expiresOn: null }, {});
  f.c.context({ id: 'other', role: 'driver' }); read.resolve({ base64: 'old-account' }); await upload;
  assert.equal(f.commands.length, 0);
  f.c.context(driver); await f.c.poll(); const response = deferred();
  f.client.command = (path, data) => { f.commands.push({ path, data }); return response.promise; };
  const first = f.c.run('submit', { expectedVersion: 7 }); await f.c.run('submit', { expectedVersion: 7 });
  assert.equal(f.commands.length, 1); assert.deepEqual(f.commands[0], { path: '/api/driver/application/submit', data: { expectedVersion: 7 } });
  response.resolve({ application: { ...application, version: 8, status: 'submitted' } });
  f.client.request = async () => ({ application: { ...application, version: 8, status: 'submitted' } }); await first;
  assert.equal(f.accepted, 1); assert.equal(f.views.at(-1).pending, false);
});

test('a stale poll cannot replace saved evidence; stale review failures do not resubmit and denied reads clear private fields', async () => {
  const f = controller(); f.c.context(admin); await f.c.open('driver');
  const old = deferred(); f.client.request = () => old.promise; const polling = f.c.poll();
  f.client.request = async () => ({ application: { ...application, version: 8 } });
  await f.c.run('review', { expectedVersion: 7, decision: 'approved' });
  old.resolve({ application }); await polling; assert.equal(f.views.at(-1).application.version, 8);
  f.client.command = async () => { throw Object.assign(new Error('Review the current version'), { status: 409 }); };
  await f.c.run('review', { expectedVersion: 7, decision: 'approved' });
  assert.match(f.views.at(-1).error, /current version/); assert.equal(f.commands.length, 1);
  f.client.request = async () => { throw Object.assign(new Error('Sign in'), { status: 401 }); };
  await f.c.poll(); assert.equal(f.views.at(-1).application, null);
});

const vehicleSource = (await readFile(new URL('../public/dashboard/vehicle-card.mjs', import.meta.url), 'utf8'))
  .replace("'./dom.mjs'", `'${new URL('../public/dashboard/dom.mjs', import.meta.url)}'`)
  .replace("'/shared/vehicle-profile.mjs'", `'${new URL('../../../packages/shared/src/vehicle-profile.mjs', import.meta.url)}'`);
const vehicleModule = `data:text/javascript;base64,${Buffer.from(vehicleSource).toString('base64')}`;
const fieldsSource = (await readFile(new URL('../public/dashboard/vehicle-fields.mjs', import.meta.url), 'utf8'))
  .replace("'./dom.mjs'", `'${new URL('../public/dashboard/dom.mjs', import.meta.url)}'`)
  .replace("'/shared/vehicle-profile.mjs'", `'${new URL('../../../packages/shared/src/vehicle-profile.mjs', import.meta.url)}'`)
  .replace("'/shared/vehicle-registration.mjs'", `'${new URL('../../../packages/shared/src/vehicle-registration.mjs', import.meta.url)}'`);
const fieldsModule = `data:text/javascript;base64,${Buffer.from(fieldsSource).toString('base64')}`;
const source = (await readFile(new URL('../public/dashboard/onboarding-view.mjs', import.meta.url), 'utf8'))
  .replace("'./dom.mjs'", `'${new URL('../public/dashboard/dom.mjs', import.meta.url)}'`)
  .replace("'./vehicle-card.mjs'", `'${vehicleModule}'`)
  .replace("'./vehicle-fields.mjs'", `'${fieldsModule}'`)
  .replace("'/shared/vehicle-profile.mjs'", `'${new URL('../../../packages/shared/src/vehicle-profile.mjs', import.meta.url)}'`)
  .replace("'/shared/driver-onboarding.mjs'", `'${new URL('../../../packages/shared/src/driver-onboarding.mjs', import.meta.url)}'`);
const { createOnboardingView } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const html = await readFile(new URL('../public/dashboard.html', import.meta.url), 'utf8');
function dom(t) {
  const original = globalThis.document, nodes = new Map();
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.value = ''; this.textContent = ''; this.handlers = {}; this.checked = false; }
    set id(value) { this._id = value; nodes.set(value, this); } get id() { return this._id; }
    append(...children) { this.children.push(...children); if (this.tag === 'select' && !this.value && children[0]) this.value = children[0].value; }
    replaceChildren(...children) { this.children = children; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    setAttribute(name, value) { this[name] = value; }
    setCustomValidity(value) { this.validationMessage = value; }
    reset() {
      const fields = this.id.includes('details') ? ['legalName', 'phone', 'licenceNumber', 'make', 'model', 'year', 'colour', 'plate']
        : this.id.includes('upload') ? ['expiresOn', 'file'] : ['reason', 'reference'];
      for (const name of fields) nodes.get('onboarding-' + name).value = '';
      if (this.id.includes('review')) for (const key of ['identity', 'licence', 'vehicle', 'insurance']) nodes.get('onboarding-check-' + key).checked = false;
    }
    scrollIntoView() {}
  }
  for (const [, tag, id] of html.matchAll(/<(\w+)\b[^>]*?\bid="([^"]+)"/g)) { const node = new Element(tag); node.id = id; }
  const node = (id) => { assert.ok(nodes.has(id), id); return nodes.get(id); };
  globalThis.document = { getElementById: node, createElement: (tag) => new Element(tag) };
  t.after(() => { globalThis.document = original; });
  const actions = [], downloads = [], view = createOnboardingView({ onAction: (...args) => actions.push(args), onDownload: (id) => downloads.push(id), onClose() {} });
  const event = { preventDefault() {} };
  return { node, view, actions, downloads, event, render: (app = application, who = driver, pending = false) => view.render({ user: who, application: app, pending, error: '' }) };
}

test('onboarding forms preserve unsaved text and its version, reset review checks after changes and render private strings as text', (t) => {
  const f = dom(t); f.render();
  assert.equal(f.node('onboarding-phone').value, application.details.phone);
  f.node('onboarding-legalName').value = 'Unsaved name'; f.node('onboarding-details-form').handlers.input();
  assert.equal(f.node('onboarding-upload-fields').disabled, true);
  f.render({ ...application, version: 8 });
  assert.equal(f.node('onboarding-legalName').value, 'Unsaved name'); assert.equal(f.node('onboarding-stale').hidden, false);
  f.node('onboarding-details-form').handlers.submit(f.event);
  assert.equal(f.actions[0][1].expectedVersion, 7, 'unsaved edits cannot overwrite unseen changes');
  f.node('onboarding-reload').handlers.click(); assert.equal(f.node('onboarding-legalName').value, application.details.legalName);
  const submitted = { ...application, status: 'submitted', version: 9 };
  f.view.reset(); f.render(submitted, admin);
  assert.equal(f.node('onboarding-summary').children[1].textContent, '<Private legal name>');
  f.node('onboarding-check-identity').checked = true; f.render({ ...submitted, version: 10 }, admin);
  assert.equal(f.node('onboarding-check-identity').checked, false);
  f.node('onboarding-reason').value = 'Document does not match.';
  f.node('onboarding-review-form').handlers.submit({ ...f.event, submitter: { value: 'changes_requested' } });
  assert.equal(f.actions.at(-1)[1].expectedVersion, 10); assert.equal(f.actions.at(-1)[1].decision, 'changes_requested');
  f.view.reset(); f.render(null, null);
  for (const name of ['phone', 'licenceNumber', 'legalName', 'reference', 'reason', 'file']) assert.equal(f.node('onboarding-' + name).value, '');
  assert.equal(f.node('onboarding-summary').children.length, 0); assert.equal(f.node('onboarding-panel').hidden, true);
});

test('onboarding controls bind uploads, downloads and changes to current evidence and respect busy/approved states', (t) => {
  const f = dom(t); f.render();
  f.node('onboarding-kind').value = 'insurance'; f.node('onboarding-kind').handlers.change();
  assert.equal(f.node('onboarding-expiresOn').required, true);
  f.node('onboarding-expiresOn').value = '2099-01-01'; const file = { name: 'image.png' }; f.node('onboarding-file').files = [file];
  f.node('onboarding-upload-form').handlers.submit(f.event);
  assert.deepEqual(f.actions.at(-1), ['upload', { expectedVersion: 7, kind: 'insurance', expiresOn: '2099-01-01' }, file]);
  const controls = f.node('onboarding-documents').children[0].children[1].children;
  controls[0].handlers.click(); assert.deepEqual(f.downloads, ['doc']); controls[1].handlers.click();
  assert.deepEqual(f.actions.at(-1), ['remove', { expectedVersion: 7, documentId: 'doc' }]);
  f.render({ ...application, status: 'approved', eligibility: { eligible: true, missing: [], expired: [] }, busy: true });
  assert.equal(f.node('onboarding-details-fields').disabled, true); assert.equal(f.node('onboarding-reopen').disabled, true);
  f.render({ ...application, status: 'submitted' }, admin, true);
  assert.equal(f.node('onboarding-review-fields').disabled, true); assert.equal(f.node('onboarding-details-form').hidden, true);
});


test('a cookie switch between page refresh and private reads cannot show a different driver application', async () => {
  const f = controller(); f.c.context(driver);
  f.client.request = async () => ({ application: { ...application, driverId: 'other' } });
  await f.c.poll(); assert.equal(f.views.at(-1).application, null); assert.match(f.views.at(-1).error, /session changed/);
  f.client.request = async () => ({ application }); await f.c.poll();
  f.client.request = async () => ({ document: { id: 'doc', driverId: 'other' }, base64: 'private' });
  await f.c.download('doc'); assert.equal(f.saved.length, 0);
});

test('vehicle previews follow unsaved details, keep identity as text, and clear on account reset', (t) => {
  const f = dom(t); f.render();
  const card = () => f.node('onboarding-vehicle-preview').children[0];
  assert.equal(card().children[0].children[0].src,'/assets/vehicles/sedan-yellow.png');
  assert.equal(card().children[1].children[1].textContent,'Toyota Corolla');
  f.node('onboarding-colour').value = 'Blue'; f.node('onboarding-model').value = '__other__';
  f.node('onboarding-model').handlers.change(); f.node('onboarding-model-other').value = '<New model>';
  f.node('onboarding-details-form').handlers.input();
  assert.equal(card().children[0].children[0].src,'/assets/vehicles/sedan-blue.png');
  assert.equal(card().children[1].children[1].textContent,'Toyota <New model>');
  assert.equal(card().children[1].children[0].textContent,'UNSAVED VEHICLE PREVIEW');
  assert.equal(f.node('onboarding-submit').disabled,true);
  f.view.reset(); assert.equal(f.node('onboarding-vehicle-preview').children.length,0);
});

test('vehicle dropdowns reset the previous model on make changes and send explicit custom values', (t) => {
  const f = dom(t); f.render();
  const values = (name) => f.node('onboarding-' + name).children.map((option) => option.value);
  assert.ok(values('year').includes('2000')); assert.ok(!values('year').includes('1999'));
  assert.equal(values('year')[1],String(new Date().getUTCFullYear()));
  f.node('onboarding-make').value = 'Honda'; f.node('onboarding-make').handlers.change();
  assert.equal(f.node('onboarding-model').value,'');
  assert.ok(values('model').includes('Civic')); assert.ok(!values('model').includes('Corolla'));
  f.node('onboarding-model').value = 'Civic'; f.node('onboarding-model').handlers.change();
  f.render({ ...application,version:8 });
  assert.equal(f.node('onboarding-make').value,'Honda'); assert.equal(f.node('onboarding-model').value,'Civic');
  for (const [name,text] of [['make','Unlisted make'],['model','Unlisted model'],['colour','Blue and white']]) {
    f.node('onboarding-' + name).value = '__other__'; f.node('onboarding-' + name).handlers.change();
    assert.equal(f.node('onboarding-' + name + '-other-row').hidden,false);
    f.node('onboarding-' + name + '-other').value = text; f.node('onboarding-' + name + '-other').handlers.input();
  }
  f.node('onboarding-details-form').handlers.submit(f.event);
  assert.deepEqual(f.actions.at(-1)[1].details.vehicle,{ make:'Unlisted make',model:'Unlisted model',year:2020,colour:'Blue and white',plate:'TEST-123' });
  assert.equal(f.actions.at(-1)[1].expectedVersion,7);
  f.view.reset();
  for (const name of ['make','model','colour']) {
    assert.equal(f.node('onboarding-' + name + '-other').value,'');
    assert.equal(f.node('onboarding-' + name + '-other-row').hidden,true);
  }
});

test('saved unlisted details and pre-2000 years remain visible, without becoming a valid new application', (t) => {
  const f = dom(t), old = { ...application,details:{ ...application.details,vehicle:{ make:'Unlisted',model:'<Actual model>',year:1999,colour:'Two tone',plate:'OLD-123' } } };
  f.render(old);
  assert.equal(f.node('onboarding-make').value,'__other__');
  assert.equal(f.node('onboarding-model-other').value,'<Actual model>');
  assert.equal(f.node('onboarding-year').value,'1999'); assert.match(f.node('onboarding-year').validationMessage,/2000/);
  f.node('onboarding-year').value = '2000'; f.node('onboarding-year').handlers.change();
  assert.equal(f.node('onboarding-year').validationMessage,'');
  f.node('onboarding-details-form').handlers.submit(f.event);
  assert.equal(f.actions.at(-1)[1].details.vehicle.model,'<Actual model>'); assert.equal(f.actions.at(-1)[1].details.vehicle.year,2000);
});

test('a first application carries the initial vehicle selection into the full form without inventing personal details', (t) => {
  const f = dom(t), selected = { ...application.details.vehicle, colour: 'Blue' };
  f.render({ ...application, version: 0, details: null, vehicle: selected, documents: [] });
  for (const [name, value] of Object.entries(selected)) assert.equal(f.node('onboarding-' + name).value, String(value));
  for (const name of ['legalName', 'phone', 'licenceNumber']) assert.equal(f.node('onboarding-' + name).value, '');
  assert.equal(f.node('onboarding-submit').disabled, true);
  assert.equal(f.node('onboarding-vehicle-preview').children[0].children[0].children[0].src, '/assets/vehicles/sedan-blue.png');
  for (const name of ['legalName', 'phone', 'licenceNumber']) f.node('onboarding-' + name).value = application.details[name];
  f.node('onboarding-details-form').handlers.submit(f.event);
  assert.deepEqual(f.actions.at(-1), ['save', { expectedVersion: 0, details: { ...application.details, vehicle: selected } }]);
});
