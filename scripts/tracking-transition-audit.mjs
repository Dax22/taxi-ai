import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openPostgresDatabase } from '../services/api/src/infrastructure/postgres.mjs';

/** Aggregate-only, read-only audit. It does not pause bookings or make cutover safe by itself. */
export async function auditTrackingTransition(db) {
  const columns = db.kind === 'postgres'
    ? await db.prepare("SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='parcel_tracking_links'").all()
    : await db.prepare('PRAGMA table_info(parcel_tracking_links)').all();
  if (!columns.length) throw new Error('Parcel schema is unavailable; do not proceed.');
  const bound = columns.some(column => column.name === 'intended_email_hash');
  const unbound = bound ? 'l.intended_email_hash IS NULL' : '1=1';
  const active = "r.status<>'cancelled' AND (t.status IS NULL OR t.status NOT IN ('completed','cancelled'))";
  const number = async sql => Number((await db.prepare(sql).get()).n);
  const activeParcels = await number(`SELECT count(*) AS n FROM delivery_orders d JOIN rides r ON r.id=d.ride_id LEFT JOIN ride_trips t ON t.ride_id=r.id WHERE ${active}`);
  const activeTrips = await number("SELECT count(*) AS n FROM ride_trips WHERE status NOT IN ('completed','cancelled')");
  const legacyActiveGrants = await number(`SELECT count(*) AS n FROM parcel_tracking_links l JOIN rides r ON r.id=l.ride_id LEFT JOIN ride_trips t ON t.ride_id=r.id WHERE l.active=1 AND ${unbound} AND (${active})`);
  const legacyAcceptedHistory = await number(`SELECT count(*) AS n FROM parcel_tracking_links l JOIN rides r ON r.id=l.ride_id LEFT JOIN ride_trips t ON t.ride_id=r.id WHERE l.active=1 AND l.recipient_id IS NOT NULL AND ${unbound} AND NOT (${active})`);
  return { bindingColumnsPresent:bound, activeTrips, activeParcels, legacyActiveGrants, legacyAcceptedHistory,
    drainRequired:activeTrips>0||activeParcels>0, advisoryOnly:true,
    instructions:'Do not revoke active invitations or cancel jobs automatically. Recheck after writes are paused in the approved maintenance window. Existing completed invitations need support/history communication; they cannot simply be replaced after completion.' };
}

async function main() {
  let db;
  try {
    if (process.env.TAXI_AI_DATABASE_URL) {
      db=await openPostgresDatabase({verify:false,max:1});
      const result=await db.transaction(async()=>{await db.exec('SET TRANSACTION READ ONLY');return auditTrackingTransition(db);});
      console.log(JSON.stringify(result,null,2));if(result.drainRequired)process.exitCode=2;
    } else {
      if (!process.env.TAXI_AI_DB) throw new Error('Set the existing database path; no database is created.');
      db=new DatabaseSync(process.env.TAXI_AI_DB,{readOnly:true});db.exec('PRAGMA query_only=ON; BEGIN;');
      const result=await auditTrackingTransition(db);db.exec('ROLLBACK');console.log(JSON.stringify(result,null,2));if(result.drainRequired)process.exitCode=2;
    }
  } catch {console.error('Read-only transition audit failed. No migration or account change was attempted.');process.exitCode=1;}
  finally{await db?.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
