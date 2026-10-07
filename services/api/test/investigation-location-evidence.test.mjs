import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../src/infrastructure/database.mjs';
import { createLocationsRepository } from '../src/modules/locations/repository.mjs';
import { createAdminInvestigationsRepository } from '../src/modules/admin-investigations/repository.mjs';
import { exportRequest } from '../src/modules/admin-investigations/domain.mjs';

test('investigation location evidence is sampled, queryable and prunable without retaining session secrets', async () => {
  const db = openDatabase(':memory:');
  try {
    const locations = createLocationsRepository(db), investigations = createAdminInvestigationsRepository(db);
    const shareId = randomUUID(), rideId = randomUUID(), driverId = randomUUID(), now = Date.UTC(2026, 9, 7, 12);
    const point = (capturedAt, lat) => ({ lat, lng: 7.4, accuracy: 8, capturedAt });
    assert.equal(await locations.recordEvidence({ shareId, rideId, driverId, sequence: 1, value: point(now, 9.08), now }), true);
    assert.equal(await locations.recordEvidence({ shareId, rideId, driverId, sequence: 2, value: point(now + 5_000, 9.081), now: now + 5_000 }), false);
    assert.equal(await locations.recordEvidence({ shareId, rideId, driverId, sequence: 3, value: point(now + 15_000, 9.082), now: now + 15_000 }), true);
    assert.equal(await locations.recordEvidence({ shareId, rideId, driverId, sequence: 4, value: point(now + 16_000, 9.083), now: now + 16_000, force: true }), true);
    const rows = await investigations.locationEvidence('ride', rideId);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(r => r.sequence), [1,3,4]);
    assert.deepEqual(rows.map(r => r.latitude), [9.08,9.082,9.083]);
    assert.equal(await investigations.locationEvidenceCount('ride', rideId), 3);
    await locations.pruneEvidence(now + 20_000);
    assert.equal(await investigations.locationEvidenceCount('ride', rideId), 0);
  } finally { db.close(); }
});

test('investigation export request requires a separate historical-location disclosure choice', () => {
  const base = {
    service:'ride', transactionId:randomUUID(), caseReference:'POLICE-CASE-001',
    requestingAuthority:'Nigeria Police investigation unit', legalBasis:'documented_police_request',
    authorityReference:'SIGNED-REQUEST-001', purpose:'Investigate a reported incident connected with a recorded passenger journey.',
    includeDocuments:'no', includeMessages:'no', includeLocation:'yes', acknowledged:'yes',
  };
  assert.equal(exportRequest(base).includeLocation, true);
  assert.equal(exportRequest({ ...base, includeLocation:'no' }).includeLocation, false);
  assert.throws(() => exportRequest({ ...base, includeLocation:'maybe' }));
});
