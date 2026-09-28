import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as flush } from 'node:timers/promises';
import { readDriverFile } from '../src/onboarding/document-file.ts';
import { detailsFromDraft, draftFromDetails } from '../src/onboarding/form.ts';
import { parseOnboarding } from '../../../packages/shared/src/mobile-contracts.mjs';
import { MAX_DRIVER_FILE_BYTES } from '../../../packages/shared/src/driver-onboarding.mjs';
import type { DriverOnboarding, DriverFaceCheck } from '../../../packages/shared/src/mobile-contracts.mjs';
import { canCompareDriverFace, pollDriverFaceCheck } from '../src/onboarding/face-check.ts';
const details = { legalName: 'Fictional Driver', phone: '+2348000000000', licenceNumber: 'TEST-LICENCE',
  vehicle: { make: 'Toyota', model: 'Corolla', year: 2020, colour: 'Silver', plate: 'TEST-123' } };
const application = { driverId: 'driver',status:'draft',version:1,busy:false,details,vehicle:details.vehicle,
  documents:[],eligibility:{ eligible:false,missing:['profile_photo'],expired:[] },reviewReason:null };

test('a form preserves structured model identity, accepts unlisted vehicles and never submits a preview asset or approval', () => {
  const draft = draftFromDetails(details);
  assert.deepEqual(detailsFromDraft(draft), { ...details, vehicle: { ...details.vehicle, category: 'standard', payloadKg: null } });
  assert.deepEqual(detailsFromDraft({ ...draft,make:'Other make',model:'Unlisted model',colour:'Blue and white',plate:' new-456 ' }).vehicle,
    { make:'Other make',model:'Unlisted model',year:2020,colour:'Blue and white',plate:'NEW-456',category:'standard',payloadKg:null });
  for (const input of [{ year:'2020.5' },{ year:'' },{ phone:'08000000000' },{ plate:'<script>' },{ licenceNumber:'' }]) {
    assert.throws(() => detailsFromDraft({ ...draft,...input }));
  }
  assert.equal(draftFromDetails(null,{ ...details.vehicle,model:'Toyota Corolla',modelName:'Corolla' }).model,'Corolla');
  const continued = draftFromDetails(null,details.vehicle);
  assert.deepEqual(detailsFromDraft({ ...continued,legalName:details.legalName,phone:details.phone,licenceNumber:details.licenceNumber }).vehicle,{ ...details.vehicle, category: 'standard', payloadKg: null });
});

test('native private application contracts reject malformed evidence, duplicate documents and invented approval states', () => {
  const wrap = (app: unknown) => ({ apiVersion:1,serverNow:1000,application:app });
  assert.deepEqual(parseOnboarding(wrap(application)),application);
  const doc = { id:'doc',kind:'insurance',name:'fixture.jpg',mimeType:'image/jpeg',sizeBytes:50,expiresOn:'2099-12-31' };
  assert.equal(parseOnboarding(wrap({ ...application,documents:[doc] })).documents.length,1);
  for (const data of [{ status:'auto_approved' },{ version:'1' },{ details:{ ...details,vehicle:{ ...details.vehicle,year:NaN } } },
    { documents:[doc,doc] },{ documents:[{ ...doc,expiresOn:null }] },{ documents:[{ ...doc,mimeType:'image/svg+xml' }] },
    { documents:[{ ...doc,sizeBytes:MAX_DRIVER_FILE_BYTES+1 }] }]) assert.throws(() => parseOnboarding(wrap({ ...application,...data })));
});

test('native registration accepts the year boundaries but requires correction of pre-2000 saved vehicles', () => {
  const now = Date.UTC(2026,8,20), draft = draftFromDetails(details);
  for (const year of ['2000','2026']) assert.equal(detailsFromDraft({ ...draft,year },now).vehicle.year,Number(year));
  for (const year of ['1999','2027','2e3','2000.0']) assert.throws(() => detailsFromDraft({ ...draft,year },now),/2000 to 2026/);
  const old = { ...details,vehicle:{ ...details.vehicle,year:1999 } };
  const parsed = parseOnboarding({ apiVersion:1,serverNow:now,application:{ ...application,details:old,vehicle:old.vehicle } });
  assert.equal(draftFromDetails(parsed.details).year,'1999','legacy reads preserve the actual saved year');
  assert.throws(() => detailsFromDraft(draftFromDetails(parsed.details),now),/2000/);
});

test('selected image reads are bounded, filenames are portable and cache copies are removed after success or failure', async () => {
  const selected = { uri:'file:///app/cache/DocumentPicker/photo.jpg',name:'My 🚗 vehicle.jpg',mimeType:'image/jpeg' };
  let read = 0, removed = 0;
  const file = { exists:true,size:100,base64:async () => { read++; return 'YWJj'; },delete:() => { removed++; } };
  const image = await readDriverFile(selected,file,'file:///app/cache/');
  assert.equal(image.name,'My __ vehicle.jpg'); assert.equal(image.base64,'YWJj'); assert.equal(read,1); assert.equal(removed,1);
  await assert.rejects(readDriverFile(selected,{ ...file,size:MAX_DRIVER_FILE_BYTES+1 },'file:///app/cache'));
  assert.equal(read,1); assert.equal(removed,2);
  await assert.rejects(readDriverFile(selected,{ ...file,base64:async () => { throw new Error('File unavailable'); } },'file:///app/cache'),/File unavailable/);
  assert.equal(removed,3);
  await assert.rejects(readDriverFile({ ...selected,mimeType:'image/heic' },file,'file:///app/cache'));
  assert.equal(read,1); assert.equal(removed,4);
  await assert.rejects(readDriverFile({ ...selected,uri:'file:///app/cache-original/photo.jpg' },file,'file:///app/cache'));
  assert.equal(read,1); assert.equal(removed,4,'never delete an original outside the cache directory');
});

test('native vehicle applications retain category and require a bounded delivery capacity', () => {
  const draft = { ...draftFromDetails(details), category: 'motorcycle' as const, payloadKg: '10' };
  assert.equal(detailsFromDraft(draft).vehicle.payloadKg, 10); assert.equal(detailsFromDraft(draft).vehicle.category, 'motorcycle');
  for (const payloadKg of ['', '0', '21', 'abc']) assert.throws(() => detailsFromDraft({ ...draft, payloadKg }));
  assert.equal(draftFromDetails({ ...details, vehicle: detailsFromDraft(draft).vehicle }).payloadKg, '10');
});

test('native face comparison requires explicit consent, current saved evidence and an editable application', () => {
  const check: DriverFaceCheck = { available: true, provider: 'aws_rekognition', status: 'not_started', reason: null, checkedAt: null,
    similarity: null, threshold: 95, consentVersion: 'driver-face-match-v1', retryAfter: null };
  const app = parseOnboarding({ apiVersion: 1, serverNow: 1000, application: { ...application, faceCheck: check, documents: [
    { id: 'selfie', kind: 'profile_photo', name: 'selfie.jpg', mimeType: 'image/jpeg', sizeBytes: 100, expiresOn: null },
    { id: 'licence', kind: 'driving_licence', name: 'licence.jpg', mimeType: 'image/jpeg', sizeBytes: 100, expiresOn: '2099-12-31' },
  ] } });
  const options = { consent: true, now: 1000 };
  assert.equal(canCompareDriverFace(app, options), true);
  assert.equal(canCompareDriverFace(app, { ...options, consent: false }), false);
  assert.equal(canCompareDriverFace(app, { ...options, blocked: true }), false, 'pending requests, stale details and unsaved changes block comparison');
  for (const patch of [{ faceCheck: undefined }, { documents: [] }, { busy: true }, { status: 'submitted' as const }, { status: 'approved' as const },
    { faceCheck: { ...check, available: false } }, { faceCheck: { ...check, status: 'pending' as const } },
    { faceCheck: { ...check, status: 'matched' as const } }, { faceCheck: { ...check, retryAfter: 1001 } }]) {
    assert.equal(canCompareDriverFace({ ...app, ...patch }, options), false);
  }
  assert.equal(canCompareDriverFace({ ...app, faceCheck: { ...check, status: 'needs_review', retryAfter: 1000 } }, options), true);
  assert.equal(app.status, 'draft'); assert.equal(app.eligibility.eligible, false);
});

test('native face results preserve review states and reject malformed evidence without breaking older servers', () => {
  const check: DriverFaceCheck = { available: true, provider: 'aws_rekognition', status: 'needs_review', reason: 'low_similarity', checkedAt: 1000,
    similarity: 54, threshold: 95, consentVersion: 'driver-face-match-v1', retryAfter: 61000 };
  const parse = (faceCheck: unknown): DriverOnboarding => parseOnboarding({ apiVersion: 1, serverNow: 1000, application: { ...application, faceCheck } });
  assert.equal(parse(undefined).faceCheck, undefined);
  assert.equal(parse(check).faceCheck?.status, 'needs_review');
  assert.equal(parse({ ...check, threshold: null }).faceCheck?.threshold, null);
  for (const patch of [{ available: 'yes' }, { status: 'approved' }, { similarity: 101 }, { similarity: NaN }, { threshold: -1 },
    { checkedAt: 'now' }, { retryAfter: -1 }, { reason: { rawProviderError: true } }, { consentVersion: null }]) {
    assert.throws(() => parse({ ...check, ...patch }), /incompatible response/);
  }
});

test('pending comparison recovery reads serially, pauses during edits and never publishes after leaving the account', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = parseOnboarding({ apiVersion: 1, serverNow: 1000, application });
  let reads = 0, updates = 0, busy = true, current = true, timedOut = false;
  let finish!: (value: DriverOnboarding) => void;
  let signal!: AbortSignal;
  const stop = pollDriverFaceCheck({ read: (s) => { reads++; signal = s; return new Promise((resolve) => { finish = resolve; }); },
    current: () => current, busy: () => busy, update: () => { updates++; }, timeout: () => { timedOut = true; } });
  t.mock.timers.tick(2000); await flush(); assert.equal(reads, 0);
  busy = false; t.mock.timers.tick(2000); await flush(); assert.equal(reads, 1);
  t.mock.timers.tick(10000); await flush(); assert.equal(reads, 1, 'an unfinished read cannot overlap another');
  current = false; stop(); assert.equal(signal.aborted, true);
  finish(app); await flush(); assert.equal(updates, 0);
  t.mock.timers.tick(100000); await flush(); assert.equal(reads, 1); assert.equal(timedOut, false);
});

test('pending comparison recovery stops on a terminal result or its deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = parseOnboarding({ apiVersion: 1, serverNow: 1000, application });
  let reads = 0, updates = 0, timedOut = 0;
  pollDriverFaceCheck({ read: async () => { reads++; return app; }, current: () => true, busy: () => false,
    update: () => { updates++; }, timeout: () => { timedOut++; } });
  t.mock.timers.tick(2000); await flush(); t.mock.timers.tick(100000); await flush();
  assert.equal(reads, 1); assert.equal(updates, 1); assert.equal(timedOut, 0);
  let signal!: AbortSignal;
  pollDriverFaceCheck({ read: (s) => { signal = s; return new Promise(() => {}); }, current: () => true, busy: () => false,
    update: () => { updates++; }, timeout: () => { timedOut++; } });
  t.mock.timers.tick(2000); await flush(); t.mock.timers.tick(88000); await flush();
  assert.equal(signal.aborted, true); assert.equal(timedOut, 1); assert.equal(updates, 1);
});
