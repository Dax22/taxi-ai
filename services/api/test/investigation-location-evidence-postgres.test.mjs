import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPostgresDatabase } from '../src/infrastructure/postgres.mjs';
import { createLocationsRepository } from '../src/modules/locations/repository.mjs';
import { createAdminInvestigationsRepository } from '../src/modules/admin-investigations/repository.mjs';

const connectionString = process.env.TAXI_AI_TEST_POSTGRES_URL;
test('PostgreSQL stores and reads sampled investigation GPS evidence with the current schema', {
  skip: !connectionString && 'Set TAXI_AI_TEST_POSTGRES_URL to a disposable PostgreSQL database.',
}, async () => {
  const schema='test_investigation_'+randomUUID().replaceAll('-','');
  const db=await openPostgresDatabase({connectionString,schema,migrate:true,max:2});
  try {
    const locations=createLocationsRepository(db), investigations=createAdminInvestigationsRepository(db);
    const rideId=randomUUID(),shareId=randomUUID(),driverId=randomUUID(),now=Date.UTC(2026,9,7,12);
    const value={lat:9.08,lng:7.4,accuracy:7,capturedAt:now};
    assert.equal(await locations.recordEvidence({shareId,rideId,driverId,sequence:1,value,now}),true);
    const rows=await investigations.locationEvidence('ride',rideId);
    assert.equal(rows.length,1); assert.equal(rows[0].latitude,9.08); assert.equal(rows[0].accuracyMeters,7);
    const column=await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='investigation_exports' AND column_name='included_location'");
    assert.equal(column.rows.length,1);
  } finally {
    await db.exec(`DROP SCHEMA "${schema}" CASCADE`); await db.close();
  }
});
