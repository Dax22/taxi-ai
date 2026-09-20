import test from 'node:test';
import assert from 'node:assert/strict';
import { readDriverFile } from '../src/onboarding/document-file.ts';
import { detailsFromDraft, draftFromDetails } from '../src/onboarding/form.ts';
import { parseOnboarding } from '../../../packages/shared/src/mobile-contracts.mjs';
import { MAX_DRIVER_FILE_BYTES } from '../../../packages/shared/src/driver-onboarding.mjs';
const details = { legalName: 'Fictional Driver', phone: '+2348000000000', licenceNumber: 'TEST-LICENCE',
  vehicle: { make: 'Toyota', model: 'Corolla', year: 2020, colour: 'Silver', plate: 'TEST-123' } };
const application = { driverId: 'driver',status:'draft',version:1,busy:false,details,vehicle:details.vehicle,
  documents:[],eligibility:{ eligible:false,missing:['profile_photo'],expired:[] },reviewReason:null };

test('a form preserves structured model identity, accepts unlisted vehicles and never submits a preview asset or approval', () => {
  const draft = draftFromDetails(details);
  assert.deepEqual(detailsFromDraft(draft),details);
  assert.deepEqual(detailsFromDraft({ ...draft,make:'Other make',model:'Unlisted model',colour:'Blue and white',plate:' new-456 ' }).vehicle,
    { make:'Other make',model:'Unlisted model',year:2020,colour:'Blue and white',plate:'NEW-456' });
  for (const input of [{ year:'2020.5' },{ year:'' },{ phone:'08000000000' },{ plate:'<script>' },{ licenceNumber:'' }]) {
    assert.throws(() => detailsFromDraft({ ...draft,...input }));
  }
  assert.equal(draftFromDetails(null,{ ...details.vehicle,model:'Toyota Corolla',modelName:'Corolla' }).model,'Corolla');
  const continued = draftFromDetails(null,details.vehicle);
  assert.deepEqual(detailsFromDraft({ ...continued,legalName:details.legalName,phone:details.phone,licenceNumber:details.licenceNumber }).vehicle,details.vehicle);
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
