import { open, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openPostgresDatabase } from '../services/api/src/infrastructure/postgres.mjs';
import { openDatabase, DEFAULT_DATABASE } from '../services/api/src/infrastructure/database.mjs';
import { asAsyncDatabase } from '../services/api/src/infrastructure/async-database.mjs';

const args=process.argv.slice(2);
if(args.length!==1||args[0].startsWith('-'))throw new Error('Usage: node scripts/export-dispatch-ml-training.mjs /absolute/new-training.ndjson');
const destination=resolve(args[0]);
if(!destination.endsWith('.ndjson'))throw new Error('Training export destination must be a new .ndjson file.');
const handle=await open(destination,'wx',0o600);
let db;
try{
  db=process.env.TAXI_AI_DATABASE_URL?await openPostgresDatabase():asAsyncDatabase(openDatabase(process.env.TAXI_AI_DB ?? DEFAULT_DATABASE));
  let beforeAt=Number.MAX_SAFE_INTEGER,beforeId='~',written=0;
  for(;;){
    const rows=await db.prepare(`SELECT d.id,d.model_version AS modelVersion,d.rollout_mode AS rolloutMode,d.features_json AS featuresJson,
      d.score,d.created_at AS createdAt,o.status AS offerStatus,j.completed_at AS completedAt,j.outcome,j.arrived_at AS arrivedAt,j.departed_at AS departedAt
      FROM dispatch_ml_decisions d JOIN dispatch_offers o ON o.id=d.offer_id
      LEFT JOIN dispatch_journeys j ON j.ride_id=d.ride_id
      WHERE d.selected_actual=1 AND o.status<>'pending' AND (d.created_at<? OR (d.created_at=? AND d.id<?))
      ORDER BY d.created_at DESC,d.id DESC LIMIT 1000`).all(beforeAt,beforeAt,beforeId);
    if(!rows.length)break;
    for(const row of rows){
      const features=JSON.parse(row.featuresJson);
      const sample={modelVersion:row.modelVersion,rolloutMode:row.rolloutMode,features,
        observed:{accepted:row.offerStatus==='accepted'?1:0,completed:row.completedAt!=null?1:0,
          cancelled:row.outcome==='cancelled'?1:0,pickupObserved:row.arrivedAt!=null&&row.departedAt!=null?1:0}};
      await handle.write(JSON.stringify(sample)+'\n');written++;
    }
    const last=rows.at(-1); beforeAt=Number(last.createdAt??0); beforeId=last.id;
  }
  await handle.sync();
  console.log(JSON.stringify({event:'dispatch_ml_training_exported',rows:written,destination}));
}finally{await db?.close();await handle.close();}
