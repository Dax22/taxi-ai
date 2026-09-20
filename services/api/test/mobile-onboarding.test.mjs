import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { harness, participants, requestRide, claimRide, PASSWORD } from './helpers.mjs';
import { DETAILS, IMAGE, KINDS, approveApplication, fixtureApi } from './driver-fixtures.mjs';
import { parseOnboarding, parseActivity } from '../../../packages/shared/src/mobile-contracts.mjs';

async function native(h, web) {
  const send = async (path, data, key = randomUUID(), token) => {
    const response = await fetch(h.base + '/api/mobile/v1' + path, { method: data === undefined ? 'GET' : 'POST', headers: {
      ...(data === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, body: await response.json() };
  };
  const auth = await send('/auth/login', { email: web.user.email, password: PASSWORD, deviceName: 'Onboarding test phone' });
  assert.equal(auth.status,200);
  return { token: auth.body.credentials.accessToken, refreshToken: auth.body.credentials.refreshToken,
    send: (path,data,key) => send(path,data,key,auth.body.credentials.accessToken),
    app: async () => { const result = await send('/driver/onboarding',undefined,undefined,auth.body.credentials.accessToken); assert.equal(result.status,200); return parseOnboarding(result.body); } };
}

test('native onboarding completes the same application, rejects cross-device stale edits and cannot expose private review evidence', async (t) => {
  const h = await harness(t), { customer, admin } = await participants(h,1,{ online:false });
  const api = await native(h,customer);
  assert.equal((await api.send('/driver/onboarding')).status,403);
  assert.equal((await api.send('/driver/application/save',{ expectedVersion:0,details:DETAILS })).status,403);
  assert.equal((await api.send('/account/driver-profile',{ vehicle:{ model:'Toyota Corolla',plate:'TEST-NEW' } })).status,200);
  let app = await api.app(); assert.equal(app.version,0);
  const key = randomUUID(), data = { expectedVersion:app.version,details:DETAILS };
  const save = await api.send('/driver/application/save',data,key);
  assert.equal(save.status,200); app = parseOnboarding(save.body); assert.equal(app.details.vehicle.colour,'Yellow');
  assert.equal((await api.send('/driver/application/save',data,key)).body.replayed,true);
  assert.equal((await api.send('/driver/application/save',data)).body.error.code,'STALE_VERSION');
  assert.equal((await api.send('/driver/application/save',{ ...data,expectedVersion:app.version,driverId:admin.user.id })).status,400);
  const changed = await customer.post('/api/driver/application/save',{ expectedVersion:app.version,details:{ ...DETAILS,licenceNumber:'UPDATED-ON-WEB' } });
  assert.equal(changed.status,200);
  assert.equal((await api.send('/driver/application/submit',{ expectedVersion:app.version })).body.error.code,'STALE_VERSION');
  app = await api.app(); assert.equal(app.details.licenceNumber,'UPDATED-ON-WEB');
  for (const kind of KINDS) {
    const result = await api.send('/driver/application/upload',{ expectedVersion:app.version,kind,...IMAGE,expiresOn:kind.endsWith('photo') ? null : '2099-12-31' });
    assert.equal(result.status,200,JSON.stringify(result.body)); app = parseOnboarding(result.body);
  }
  const oldDocument = app.documents[0];
  app = parseOnboarding((await api.send('/driver/application/remove',{ expectedVersion:app.version,documentId:oldDocument.id })).body);
  assert.equal(app.documents.length,4);
  assert.equal((await api.send('/driver/application/submit',{ expectedVersion:app.version })).body.error.code,'APPLICATION_INCOMPLETE');
  app = parseOnboarding((await api.send('/driver/application/upload',{ expectedVersion:app.version,kind:oldDocument.kind,...IMAGE,expiresOn:oldDocument.expiresOn })).body);
  assert.ok(!app.documents.some((d) => d.id === oldDocument.id));
  app = parseOnboarding((await api.send('/driver/application/submit',{ expectedVersion:app.version })).body);
  assert.equal(app.status,'submitted');
  assert.equal((await api.send('/driver/application/save',{ expectedVersion:app.version,details:DETAILS })).body.error.code,'APPLICATION_LOCKED');
  assert.equal((await api.send('/driver/application/review',{ expectedVersion:app.version,decision:'approved' })).status,404);
  assert.equal((await api.send(`/driver/onboarding/${admin.user.id}`)).status,404);
  assert.equal((await api.send(`/driver-documents/${app.documents[0].id}`)).status,404);
  await approveApplication(fixtureApi(admin),customer.user.id);
  app = await api.app(); assert.equal(app.status,'approved'); assert.equal(app.eligibility.eligible,true);
  for (const field of ['events','verification','reviewedBy']) assert.equal(app[field],undefined);
  for (const doc of app.documents) for (const field of ['base64','content','sha256','driverId','readByReviewer']) assert.equal(doc[field],undefined);
  const account = (await api.send('/session')).body.user;
  assert.deepEqual(account.driver.vehicle,{ model:'Toyota Corolla',plate:DETAILS.vehicle.plate,make:'Toyota',modelName:'Corolla',year:2020,colour:'Yellow' });
  for (const value of [DETAILS.phone,'UPDATED-ON-WEB',IMAGE.base64]) assert.ok(!JSON.stringify(account).includes(value));
  app = parseOnboarding((await api.send('/driver/application/reopen',{ expectedVersion:app.version })).body);
  assert.equal(app.eligibility.eligible,false);
});

test('approved vehicle identity is snapshotted for both native and web journeys; later drafts never alter it', async (t) => {
  const h = await harness(t), { customer,driver,admin } = await participants(h);
  const phone = await native(h,customer), driverPhone = await native(h,driver);
  let ride = await claimRide(driver,await requestRide(customer)); const original = structuredClone(ride.driver.vehicle);
  assert.equal(original.colour,'Yellow'); assert.equal(original.make,'Toyota'); assert.equal(original.year,2020);
  const activity = parseActivity((await phone.send('/activity?mode=customer')).body);
  assert.deepEqual(activity.current[0].driver.vehicle,original);
  assert.ok(!JSON.stringify(activity).includes(DETAILS.phone)); assert.ok(!JSON.stringify(activity).includes(DETAILS.licenceNumber));
  let app = await driverPhone.app();
  assert.equal((await driverPhone.send('/driver/application/reopen',{ expectedVersion:app.version })).body.error.code,'DRIVER_BUSY');
  ride = (await customer.post(`/api/rides/${ride.id}/cancel`,{ expectedVersion:ride.version })).body.ride;
  app = parseOnboarding((await driverPhone.send('/driver/application/reopen',{ expectedVersion:app.version })).body);
  app = parseOnboarding((await driverPhone.send('/driver/application/save',{ expectedVersion:app.version,details:{ ...DETAILS,vehicle:{ ...DETAILS.vehicle,make:'Honda',model:'Accord',year:2018,colour:'Blue',plate:'NEW-123' } } })).body);
  const pending = (await driverPhone.send('/session')).body.user;
  assert.equal(pending.driver.status,'pending'); assert.equal(pending.driver.vehicle.colour,undefined);
  app = parseOnboarding((await driverPhone.send('/driver/application/submit',{ expectedVersion:app.version })).body);
  await approveApplication(fixtureApi(admin),driver.user.id);
  assert.equal((await driverPhone.send('/session')).body.user.driver.vehicle.colour,'Blue');
  assert.deepEqual(parseActivity((await phone.send('/activity?mode=customer')).body).history[0].driver.vehicle,original);
  assert.deepEqual((await customer.send(`/api/rides/${ride.id}`)).body.ride.driver.vehicle,original);
});

test('native uploads retain bounded bodies and recheck device revocation after a streamed body', async (t) => {
  const h = await harness(t), driver = h.client(); await driver.register('native-upload','driver');
  const api = await native(h,driver), payload = { expectedVersion:0,...IMAGE,kind:'profile_photo',expiresOn:null };
  assert.equal((await api.send('/driver/application/upload',{ ...payload,base64:'A'.repeat(2_800_000) })).status,413);
  assert.equal((await api.send('/driver/application/save',{ expectedVersion:0,details:'a'.repeat(5000) })).status,413);
  assert.equal((await api.send('/driver/application/upload',{ ...payload,mimeType:'image/svg+xml' })).status,400);
  assert.equal((await api.send('/driver/application/upload',{ ...payload,base64:'not an image' })).status,400);
  let started, request; const ready = new Promise((resolve) => { started = resolve; });
  const data = JSON.stringify(payload);
  const result = new Promise((resolve,reject) => {
    request = httpRequest(h.base + '/api/mobile/v1/driver/application/upload',{ method:'POST',headers:{ Authorization:`Bearer ${api.token}`,
      'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),'Idempotency-Key':randomUUID() } },(response) => {
      const chunks=[]; response.on('data',(chunk) => chunks.push(chunk)); response.on('end',() => resolve({ status:response.statusCode,body:JSON.parse(Buffer.concat(chunks)) }));
    });
    request.on('error',reject); request.write(data.slice(0,15),started);
  });
  await ready; await api.send('/auth/logout',{ refreshToken:api.refreshToken }); request.end(data.slice(15));
  assert.equal((await result).status,401);
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM driver_documents').get().n,0);
});
