import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { harness, participants, requestRide, httpFetch } from './helpers.mjs';
import { sha256 } from '../src/infrastructure/evidence-zip.mjs';

function unzipStored(buffer) {
  const files = new Map(); let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034B50) {
    const len = buffer.readUInt16LE(offset + 26), extra = buffer.readUInt16LE(offset + 28), size = buffer.readUInt32LE(offset + 18);
    const name = buffer.subarray(offset + 30, offset + 30 + len).toString('utf8');
    files.set(name, buffer.subarray(offset + 30 + len + extra, offset + 30 + len + extra + size));
    offset += 30 + len + extra + size;
  }
  return files;
}
const body = (rideId, includeLocation) => ({
  service:'ride',transactionId:rideId,caseReference:'POLICE-CASE-002',requestingAuthority:'Nigeria Police investigation unit',
  legalBasis:'documented_police_request',authorityReference:'SIGNED-REQUEST-002',
  purpose:'Investigate the recorded journey chronology and authorized historical location evidence after a reported incident.',
  includeDocuments:'no',includeMessages:'no',includeLocation:includeLocation?'yes':'no',acknowledged:'yes',
});
async function download(f, data) {
  return httpFetch(f.h.base + '/api/admin/console/investigations/export', {
    method:'POST',headers:{Origin:f.h.base,Cookie:f.admin.cookie,'X-CSRF-Token':f.admin.csrf,'Content-Type':'application/json',
      'Idempotency-Key':randomUUID()},body:JSON.stringify(data),
  });
}

test('case export keeps historical GPS separately scoped and emits a hashed GeoJSON route only when authorized', async t => {
  const h = await harness(t), f = { h, ...await participants(h, 1) }, ride = await requestRide(f.customer);
  const claimed = await f.driver.post('/api/rides/' + ride.id + '/claim', { expectedVersion: ride.version });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
  const shareId=randomUUID(),driverId=f.driver.user.id;
  for (const [sequence,lat,capturedAt] of [[1,9.08,h.now],[2,9.081,h.now+15000],[3,9.082,h.now+30000]]) {
    h.db.prepare(`INSERT INTO investigation_location_evidence
      (resource_kind,transaction_id,share_id,driver_id,sequence,latitude,longitude,accuracy_meters,captured_at,recorded_at)
      VALUES ('ride',?,?,?,?,?,7.4,8,?,?)`).run(ride.id,shareId,driverId,sequence,lat,capturedAt,capturedAt);
  }
  const excluded = await download(f, body(ride.id, false));
  assert.equal(excluded.status, 200);
  const excludedFiles = unzipStored(Buffer.from(await excluded.arrayBuffer()));
  assert.equal(excludedFiles.has('actual-route.geojson'), false);
  assert.equal(excludedFiles.get('locations.csv').toString().includes('actual_driver_shared_gps'), false);

  const included = await download(f, body(ride.id, true));
  assert.equal(included.status, 200, await included.clone().text().then(v=>v.slice(0,200)));
  const zip = Buffer.from(await included.arrayBuffer()), files = unzipStored(zip);
  assert.equal(included.headers.get('x-evidence-sha256'), sha256(zip));
  assert.ok(files.has('actual-route.geojson'));
  assert.match(files.get('certificate-of-authenticity.txt').toString(), /RECORDS EXPORT CERTIFICATE/);
  const geo = JSON.parse(files.get('actual-route.geojson'));
  assert.equal(geo.features[0].geometry.type, 'LineString');
  assert.equal(geo.features[0].geometry.coordinates.length, 3);
  assert.match(files.get('locations.csv').toString(), /actual_driver_shared_gps/);
  const manifest = JSON.parse(files.get('manifest.json'));
  assert.equal(manifest.scopes.historicalLocation, true);
  const receipt = h.db.prepare('SELECT included_location AS location FROM investigation_exports WHERE archive_sha256=?').get(sha256(zip));
  assert.equal(receipt.location, 1);
});
