import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, SCHEMA_VERSION } from '../src/infrastructure/database.mjs';

const migrations = new URL('../migrations/', import.meta.url);
const apply = (db, name) => db.exec(readFileSync(new URL(name, migrations), 'utf8'));
// Schema30 adds a derived pickup region; every original ride field must survive unchanged.
function assertRidesPreserved(db, expected) {
  const rows = db.prepare('SELECT * FROM rides').all().map(row => {
    assert.equal(row.dispatch_region, `sample:${row.pickup_id}`);
    delete row.dispatch_region;
    return row;
  });
  assert.deepEqual(rows, expected);
}

function fixture(t, version, legacy = false) {
  const folder = mkdtempSync(join(tmpdir(), 'taxi-integration-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'db.sqlite'), db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON');
  for (const name of readdirSync(migrations).sort()) {
    const number = Number(name.slice(0,3));
    if (number <= (legacy ? 19 : version)) apply(db,name);
  }
  if (legacy) { apply(db,'024_driver_ratings.sql'); if (version === 21) apply(db,'025_eats_menu_photos.sql'); }
  db.exec(`PRAGMA user_version=${version}`);
  db.exec("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES ('customer','c@example.test','Customer','test','customer',1),('driver','d@example.test','Driver','test','driver',1)");
  db.exec("INSERT INTO rides(id,customer_id,driver_id,pickup_id,destination_id,suggested_fare_kobo,status,matched_at,created_at,updated_at) VALUES ('ride','customer','driver','wuse-ii','maitama',100000,'agreed',1,1,2)");
  db.exec("INSERT INTO ride_trips(ride_id,customer_id,driver_id,status,fare_kobo,booked_at,departed_at,arrived_at,started_at,completed_at) VALUES ('ride','customer','driver','completed',100000,1,2,3,4,5)");
  const details = { name:'Saved kitchen', sellerType:legacy ? 'private_kitchen' : 'home_kitchen', areaId:'wuse-ii', address:'Private saved pickup', cuisine:'Nigerian', deliveryEnabled:true, pickupEnabled:false };
  db.prepare("INSERT INTO eats_stores(id,status,details_json,created_at,updated_at) VALUES ('store','approved',?,1,2)").run(JSON.stringify(details));
  db.prepare("INSERT INTO eats_menu(id,store_id,available,details_json) VALUES ('item','store',1,?)").run(JSON.stringify({name:'Jollof rice',priceKobo:100000,...(!legacy ? {portionsRemaining:7,photoId:'photo'} : {})}));
  db.prepare("INSERT INTO eats_orders(id,store_id,customer_id,courier_id,status,snapshot_json,events_json,created_at,updated_at) VALUES ('order','store','customer','driver','assigned',?,'[]',1,2)").run(JSON.stringify({restaurant:{...details,id:'store'},lines:[{itemId:'item',quantity:1}]}));
  db.prepare("INSERT INTO eats_quotes(id,store_id,customer_id,store_version,snapshot_json,expires_at) VALUES ('quote','store','customer',0,?,123456)").run(JSON.stringify({restaurant:{...details,id:'store'},lines:[{itemId:'item',quantity:1}]}));
  if (legacy) db.exec("INSERT INTO ride_driver_ratings VALUES ('ride','customer','driver',5,2)");
  if (legacy && version === 21) db.prepare("INSERT INTO eats_menu_photos VALUES ('item','store',?,?,8)").run(Buffer.from('original-photo-bytes'),20);
  if (!legacy) db.exec("INSERT INTO eats_photos VALUES ('photo','store','c2F2ZWQ=',1)");
  const users = db.prepare('SELECT * FROM users').all(), rides = db.prepare('SELECT * FROM rides').all();
  db.close(); return {path,users,rides};
}
for (const version of [20,21]) test(`checkpoint schema ${version} upgrades without losing ratings, photos or private collection details`, (t) => {
  const f = fixture(t,version,true); let db = openDatabase(f.path);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION);
  assert.deepEqual(db.prepare('SELECT * FROM users').all(),f.users);
  assertRidesPreserved(db, f.rides);
  assert.equal(db.prepare('SELECT stars FROM ride_driver_ratings').get().stars,5);
  assert.equal(JSON.parse(db.prepare('SELECT details_json FROM eats_stores').get().details_json).sellerType,'home_kitchen');
  assert.equal(db.prepare('SELECT location FROM eats_collection_points').get().location,'Private saved pickup');
  const quote = db.prepare('SELECT snapshot_json, expires_at FROM eats_quotes').get();
  assert.equal(JSON.parse(quote.snapshot_json).restaurant.sellerType,'home_kitchen');
  assert.equal(quote.expires_at,123456);
  const item = JSON.parse(db.prepare('SELECT details_json FROM eats_menu').get().details_json);
  if (version === 21) {
    assert.equal(Buffer.from(db.prepare('SELECT content FROM eats_menu_photos').get().content).toString(),'original-photo-bytes');
    assert.equal(db.prepare('SELECT version FROM eats_menu_photos').get().version,8);
    assert.equal(Buffer.from(db.prepare('SELECT base64 FROM eats_photos WHERE id=?').get(item.photoId).base64,'base64').toString(),'original-photo-bytes');
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  const photos = db.prepare('SELECT * FROM eats_photos').all(); db.close(); db = openDatabase(f.path);
  assert.deepEqual(db.prepare('SELECT * FROM eats_photos').all(),photos); db.close();
});
for (const version of [20,21,22,23]) test(`slider schema ${version} retains existing menu quantities and photo identities`, (t) => {
  const f = fixture(t,version); const db = openDatabase(f.path);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,SCHEMA_VERSION);
  assert.deepEqual(db.prepare('SELECT * FROM users').all(),f.users);
  assertRidesPreserved(db, f.rides);
  const quote = db.prepare('SELECT snapshot_json, expires_at FROM eats_quotes').get();
  assert.equal(JSON.parse(quote.snapshot_json).restaurant.sellerType,'home_kitchen');
  assert.equal(quote.expires_at,123456);
  const item = JSON.parse(db.prepare('SELECT details_json FROM eats_menu').get().details_json);
  assert.equal(item.portionsRemaining,7); assert.equal(item.photoId,'photo');
  assert.equal(db.prepare('SELECT base64 FROM eats_photos WHERE id=?').get(item.photoId).base64,'c2F2ZWQ=');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]); db.close();
});
test('unknown version-21 layouts fail without partially applying migrations', (t) => {
  const f = fixture(t,21,true); let db = new DatabaseSync(f.path);
  db.exec('ALTER TABLE ride_driver_ratings ADD COLUMN unknown TEXT'); db.close();
  assert.throws(() => openDatabase(f.path), /Unrecognized/);
  db = new DatabaseSync(f.path); assert.equal(db.prepare('PRAGMA user_version').get().user_version,21);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='eats_photos'").get().n,0);
  assert.equal(db.prepare('SELECT stars FROM ride_driver_ratings').get().stars,5); db.close();
});
