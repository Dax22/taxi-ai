import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { harness, participants, requestRide, httpFetch, PASSWORD } from './helpers.mjs';
import { evidenceZip, sha256 } from '../src/infrastructure/evidence-zip.mjs';
import { exportRequest, csv, wat } from '../src/modules/admin-investigations/domain.mjs';
import { permissions } from '../src/modules/staff-access/domain.mjs';

const path='/api/admin/console/investigations';
const data=(id,changes={})=>({service:'ride',transactionId:id,caseReference:'NG-POLICE-2026-001',requestingAuthority:'Investigations Unit',legalBasis:'documented_police_request',
 authorityReference:'SIGNED-REQ-2026-001',purpose:'Review recorded journey chronology, vehicle details and payment status after a reported incident.',
 includeDocuments:'no',includeMessages:'no',acknowledged:'yes',...changes});
function unzipStored(buffer){
 const files=new Map();let offset=0;
 while(buffer.readUInt32LE(offset)===0x04034B50){
  const len=buffer.readUInt16LE(offset+26),extra=buffer.readUInt16LE(offset+28),size=buffer.readUInt32LE(offset+18),
   name=buffer.subarray(offset+30,offset+30+len).toString('utf8'),body=buffer.subarray(offset+30+len+extra,offset+30+len+extra+size);
  files.set(name,body);offset+=30+len+extra+size;
 }
 assert.equal(buffer.readUInt32LE(offset),0x02014B50);return files;
}
async function download(f,body,key=randomUUID()){
 return httpFetch(f.h.base+path+'/export',{method:'POST',headers:{Origin:f.h.base,Cookie:f.admin.cookie,'X-CSRF-Token':f.admin.csrf,
  'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
}

test('ZIP creates a standard stored archive with a verifiable file-hash manifest',()=>{
 const archive=evidenceZip([{name:'case.json',body:Buffer.from('{"id":1}')},{name:'evidence.csv',body:'time,location\r\n'}]);
 const files=unzipStored(archive);assert.equal(files.get('case.json').toString(),'{'+'"id":1}');
 assert.equal(files.get('evidence.csv').toString(),'time,location\r\n');assert.equal(sha256(archive),createHash('sha256').update(archive).digest('hex'));
 assert.throws(()=>evidenceZip([{name:'../secret',body:'x'}]));
 assert.throws(()=>evidenceZip([{name:'case.json',body:'a'},{name:'case.json',body:'b'}]));
 assert.match(csv(['name'],[['=HYPERLINK("evil")']]),/'=HYPERLINK/);
 assert.match(wat(Date.UTC(2026,0,1)),/2026/);
});

test('Investigation export validates legal authority before allowing sensitive disclosure',()=>{
 const id=randomUUID();assert.deepEqual(exportRequest(data(id)).includeDocuments,false);
 for(const input of [data(id,{acknowledged:'no'}),data(id,{purpose:'short'}),data(id,{legalBasis:'other'}),
  data(id,{includeDocuments:'maybe'}),data(id,{extra:'unexpected'})])assert.throws(()=>exportRequest(input));
 assert.equal(permissions('owner').includes('investigations.export'),true);
 for(const role of ['operations','support','safety','finance'])assert.equal(permissions(role).includes('investigations.export'),false);
});

test('owner downloads audited one-ride ZIP with actual recorded facts, planned route warning and no secret fields',async t=>{
 const h=await harness(t),f={h,...await participants(h,1)},ride=await requestRide(f.customer);
 const claimed=await f.driver.post(`/api/rides/${ride.id}/claim`,{expectedVersion:ride.version});assert.equal(claimed.status,200,JSON.stringify(claimed.body));
 // Explicit saved quote fixture uses known booking positions and does not imply driven GPS history.
 const route={pickup:{name:'Wuse II',lat:9.08,lng:7.4},destination:{name:'Maitama',lat:9.1,lng:7.44},
  coordinates:[[7.4,9.08],[7.44,9.1]],distanceMeters:5600,durationSeconds:1100,source:'osrm',distanceKind:'road'};
 h.db.prepare('INSERT INTO location_quotes(id,customer_id,created_at,expires_at,route_json,ride_id) VALUES(?,?,?,?,?,?)')
  .run(randomUUID(),f.customer.user.id,h.now,h.now+300000,JSON.stringify(route),ride.id);
 const get=await f.admin.send(path+`?service=ride&transactionId=${ride.id}`);assert.equal(get.status,200,JSON.stringify(get.body));
 assert.equal(get.body.record.service,'ride');assert.equal(get.body.record.workerName,f.driver.user.name);
 const response=await download(f,data(ride.id));assert.equal(response.status,200,await response.clone().text().then(v=>v.slice(0,500)));
 const zip=Buffer.from(await response.arrayBuffer());assert.equal(zip.subarray(0,4).toString('hex'),'504b0304');
 assert.equal(response.headers.get('content-type'),'application/zip');assert.match(response.headers.get('cache-control'),/no-store/);
 assert.equal(response.headers.get('x-evidence-sha256'),sha256(zip));
 const files=unzipStored(zip),trip=JSON.parse(files.get('trip.json')),
  driver=JSON.parse(files.get('driver.json')),manifest=JSON.parse(files.get('manifest.json'));
 assert.equal(trip.customer.email,f.customer.user.email);assert.equal(trip.driverOrCourier.id,f.driver.user.id);
 assert.equal(trip.bookingOrOrder.plannedRoute.pickup.name,'Wuse II');assert.equal(trip.bookingOrOrder.plannedRoute.kind,'booking_preview_not_actual_driver_track');
 assert.match(trip.locationHistoryWarning,/historical GPS/);assert.equal(files.has('chat.csv'),false);
 assert.ok(driver.applicationAtExport.identity.legalName);
 assert.equal(driver.documents.some(doc=>doc.originalFileIncluded),false);
 assert.ok(![...files.keys()].some(name=>name.startsWith('driver_documents/')));
 for(const file of manifest.files)assert.equal(sha256(files.get(file.path)),file.sha256);
 const packed=Buffer.concat([...files.values()]).toString('utf8');
 for(const secret of ['password_hash','refreshToken','pickup_pin','pickupPin','dropoff_pin','position_json','offer_sdp','token_hash','driver_face_provider_api_key'])assert.equal(packed.includes(secret),false,secret);
 const audit=h.db.prepare("SELECT count(*) AS n FROM audit_events WHERE kind='admin.investigation.export'").get();assert.equal(audit.n,1);
 const receipt=h.db.prepare('SELECT * FROM investigation_exports WHERE transaction_id=?').get(ride.id);
 assert.equal(receipt.archive_sha256,sha256(zip));assert.equal(receipt.actor_id,f.admin.user.id);
 assert.equal(receipt.requesting_authority,'Investigations Unit');assert.equal(receipt.included_documents,0);
 const history=await f.admin.send(path+`?service=ride&transactionId=${ride.id}`);assert.equal(history.body.history.length,1);
});

test('unauthenticated and non-owner investigators cannot see case preview or export protected evidence',async t=>{
 const h=await harness(t),f={h,...await participants(h,0)},ride=await requestRide(f.customer);
 const other=h.client();await other.register('police-ops');
 await f.admin.post('/api/admin/console/staff/assign',{email:other.user.email,role:'operations',expectedVersion:0,reason:'Test operations scope without investigation disclosure'});
 const login=await other.post('/api/admin/console/login',{email:other.user.email,password:PASSWORD});assert.equal(login.status,200);
 for(const client of [f.customer,other]){
  assert.equal((await client.send(path+`?service=ride&transactionId=${ride.id}`)).status,403);
  assert.equal((await client.post(path+'/export',data(ride.id))).status,403);
 }
 const unauth=await h.client().send(path);assert.equal(unauth.status,401);
 for(const invalid of [data(ride.id,{acknowledged:'no'}),data(ride.id,{caseReference:'bad'})]){
  const response=await download(f,invalid);assert.equal(response.status,400,await response.text());
 }
 assert.equal(h.db.prepare('SELECT count(*) AS n FROM investigation_exports').get().n,0);
});

test('original driver images and chat text are separately opt-in and the archive verifies original image digests',async t=>{
 const h=await harness(t),f={h,...await participants(h,1)},ride=await requestRide(f.customer);
 const claimed=await f.driver.post(`/api/rides/${ride.id}/claim`,{expectedVersion:ride.version});assert.equal(claimed.status,200,JSON.stringify(claimed.body));
 h.db.prepare('INSERT INTO chat_messages(id,ride_id,sequence,sender_id,body,created_at) VALUES(?,?,?,?,?,?)')
  .run(randomUUID(),ride.id,1,f.customer.user.id,'=HYPERLINK("not a real link")',h.now);
 const excluded=await download(f,data(ride.id));assert.equal(excluded.status,200);
 const baseFiles=unzipStored(Buffer.from(await excluded.arrayBuffer()));assert.ok(!baseFiles.has('chat.csv'));
 assert.equal([...baseFiles.keys()].filter(k=>k.startsWith('driver_documents/')).length,0);
 const raw=await download(f,data(ride.id,{includeDocuments:'yes',includeMessages:'yes'}));assert.equal(raw.status,200,await raw.clone().text().then(v=>v.slice(0,250)));
 const files=unzipStored(Buffer.from(await raw.arrayBuffer()));assert.match(files.get('chat.csv').toString(),/'=HYPERLINK/);
 const driver=JSON.parse(files.get('driver.json'));const originals=driver.documents.filter(doc=>doc.originalFileIncluded);
 assert.ok(originals.length>0,'Fixture has available private driver documents');
 for(const original of originals){const bytes=files.get(original.archivePath);assert.ok(bytes);assert.equal(sha256(bytes),original.sha256);}
 const receipt=h.db.prepare('SELECT included_documents AS docs,included_messages AS messages FROM investigation_exports WHERE archive_sha256=?').get(raw.headers.get('x-evidence-sha256'));
 assert.deepEqual({...receipt},{docs:1,messages:1});
});

test('courier investigation distinguishes saved parcel data from actual GPS and omits recipient handover PIN',async t=>{
 const h=await harness(t),f={h,...await participants(h,0)};
 const parcel={description:'Sealed test paperwork',weightKg:2,recipientName:'Fictional Recipient',pickupInstructions:'PRIVATE-PICKUP-NOT-TO-EXPORT'};
 const booking=await f.customer.post('/api/rides',{pickupId:'wuse-ii',destinationId:'maitama',vehicleCategory:'standard',delivery:parcel});
 assert.equal(booking.status,201,JSON.stringify(booking.body));
 const response=await download(f,data(booking.body.ride.id,{service:'courier'}));assert.equal(response.status,200);
 const files=unzipStored(Buffer.from(await response.arrayBuffer())),trip=JSON.parse(files.get('trip.json'));
 assert.equal(trip.service,'courier');assert.equal(trip.bookingOrOrder.parcel.recipientName,'Fictional Recipient');
 assert.match(trip.locationHistoryWarning,/historical GPS/);assert.equal(trip.bookingOrOrder.plannedRoute.recorded,false);
 assert.equal(files.get('summary.txt').toString().includes('PRIVATE-PICKUP-NOT-TO-EXPORT'),false);
 assert.match(files.get('locations.csv').toString(),/"record_type","location_evidence_type"/);
});

test('food investigation includes recorded customer, vendor, delivery destination and source amount without claiming payment',async t=>{
 const h=await harness(t),f={h,...await participants(h,0)},seller=h.client();await seller.register('investigation-kitchen');
 const must=(result,status=200)=>{assert.equal(result.status,status,JSON.stringify(result.body));return result.body;};
 let store=must(await seller.post('/api/eats/stores',{details:{name:'Fictional Kitchen',cuisine:'Nigerian',description:'Only fixture data',address:'10 Test Road',areaId:'wuse-ii',deliveryAreaIds:['wuse-ii','maitama'],prepMinutes:20,minimumKobo:100000,deliveryFeeKobo:100000}})).store;
 store=must(await seller.post(`/api/eats/stores/${store.id}/menu`,{expectedVersion:store.version,itemId:null,item:{name:'Jollof rice',description:'Test meal',category:'Meals',priceKobo:250000,available:true}})).store;
 const menu=must(await seller.send('/api/eats/store')).menu;
 store=must(await f.admin.post(`/api/eats/stores/${store.id}/review`,{expectedVersion:store.version,decision:'approved',reason:'Fixture review only',reference:'FIXTURE-REVIEW'})).store;
 store=must(await seller.post(`/api/eats/stores/${store.id}/open`,{expectedVersion:store.version,isOpen:true})).store;
 const quote=must(await f.customer.post('/api/eats/quotes',{storeId:store.id,expectedVersion:store.version,items:[{itemId:menu[0].id,quantity:1}],address:{line:'20 Fictional Close',areaId:'maitama'},instructions:'Fictional test'})).quote;
 const order=must(await f.customer.post('/api/eats/orders',{quoteId:quote.id})).order;
 const response=await download(f,data(order.id,{service:'food'}));assert.equal(response.status,200,await response.clone().text().then(v=>v.slice(0,250)));
 const files=unzipStored(Buffer.from(await response.arrayBuffer())),trip=JSON.parse(files.get('trip.json'));
 assert.equal(trip.service,'food');assert.equal(trip.customer.email,f.customer.user.email);
 assert.equal(trip.bookingOrOrder.items[0].name,'Jollof rice');assert.equal(trip.bookingOrOrder.destination.line,'20 Fictional Close');
 assert.equal(trip.payment.providerStatus??null,null);assert.equal(files.has('chat.csv'),false);
 assert.match(files.get('summary.txt').toString(),/FOOD/);
 assert.equal((await download(f,data(order.id,{service:'food',includeMessages:'yes'}))).status,400);
});
