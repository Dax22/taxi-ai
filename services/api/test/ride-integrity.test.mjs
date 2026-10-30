import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../src/application.mjs';
import { harness, participants, requestRide, claimRide } from './helpers.mjs';

async function step(client,ride,action,extra={}) {
  if(['depart','arrive'].includes(action)) await client.shareTripLocation(ride.id);
  const result=await client.post(`/api/rides/${ride.id}/${action}`,{expectedVersion:ride.version,...extra});
  assert.equal(result.status,200,JSON.stringify(result.body));
  return result.body.ride;
}
async function arrivedRide(customer,driver) {
  let ride=await claimRide(driver,await requestRide(customer));
  ride=await step(driver,ride,'offers',{amountKobo:470000});
  ride=await step(customer,ride,'accept',{offerId:ride.negotiation.currentOffer.id});
  ride=await step(customer,ride,'confirm');
  ride=await step(driver,ride,'depart');
  return step(driver,ride,'arrive');
}
const monitor=h=>createApplication({db:h.db,clock:()=>h.now}).rideIntegrity;

test('stale pickup-arrival GPS becomes an idempotent review-only observation',async t=>{
  const h=await harness(t,{persistent:true}),{customer,driver,admin}=await participants(h);
  const ride=await arrivedRide(customer,driver);
  assert.equal((await driver.send('/api/admin/console/ride-integrity')).status,403);
  assert.equal((await admin.send('/api/admin/console/ride-integrity')).body.items.length,0);
  h.advance(121_000);
  assert.equal((await monitor(h).sweep()).added,1);
  assert.equal((await monitor(h).sweep()).added,0);
  const listing=await admin.send('/api/admin/console/ride-integrity');
  assert.equal(listing.status,200,JSON.stringify(listing.body));
  assert.equal(listing.body.items.length,1);
  const signal=listing.body.items[0];
  assert.equal(signal.rideId,ride.id);
  assert.equal(signal.kind,'tracking_gap_after_arrival');
  assert.equal(signal.cancellationActorId,null);
  assert.equal(signal.reviewStatus,'open');
  assert.equal((await customer.send('/api/admin/console/ride-integrity')).status,403);
  assert.equal((await driver.send(`/api/rides/${ride.id}`)).body.ride.status,'arrived','no enforcement on active rides');
  const key=randomUUID(),data={expectedVersion:signal.version,state:'dismissed',note:'Driver confirmed a local coverage outage.'};
  const reviewed=await admin.post(`/api/admin/console/ride-integrity/${signal.id}/review`,data,key);
  assert.equal(reviewed.status,200,JSON.stringify(reviewed.body));
  assert.equal(reviewed.body.signal.reviewStatus,'dismissed');
  assert.equal((await admin.post(`/api/admin/console/ride-integrity/${signal.id}/review`,data,key)).body.replayed,true);
  assert.equal((await admin.post(`/api/admin/console/ride-integrity/${signal.id}/review`,data)).body.error.code,'STALE_VERSION');
  assert.equal((await admin.send('/api/admin/console/ride-integrity')).body.items.length,0);
  assert.equal((await admin.send('/api/admin/console/ride-integrity?state=dismissed')).body.items.length,1);
  await h.restart();
  assert.equal((await admin.send(`/api/admin/console/ride-integrity/${signal.id}`)).body.signal.reviewStatus,'dismissed');
});

test('fresh GPS suppresses gap, while a later cancellation records the actor and reason without blocking it',async t=>{
  const h=await harness(t),{customer,driver,admin}=await participants(h);
  let ride=await arrivedRide(customer,driver);
  h.advance(121_000);
  await driver.shareTripLocation(ride.id);
  assert.equal((await monitor(h).sweep()).added,0,'reconnected sharing is not a missing heartbeat');
  ride=await step(customer,ride,'cancel',{reason:'pickup_problem'});
  assert.equal(ride.status,'cancelled');
  const service=monitor(h);
  assert.equal((await service.sweep()).added,1);
  assert.equal((await service.sweep()).added,0);
  const items=(await admin.send('/api/admin/console/ride-integrity')).body.items;
  assert.equal(items.length,1);
  assert.equal(items[0].kind,'cancelled_after_arrival');
  assert.equal(items[0].cancellationActorId,customer.user.id);
  assert.equal(items[0].cancellationReason,'pickup_problem');
  assert.equal((await driver.send(`/api/rides/${ride.id}`)).body.ride.status,'cancelled');
});

test('cancelling before pickup does not produce an integrity signal',async t=>{
  const h=await harness(t),{customer,driver,admin}=await participants(h);
  let ride=await claimRide(driver,await requestRide(customer));
  ride=await step(driver,ride,'cancel',{reason:'plans_changed'});
  assert.equal(ride.status,'cancelled');
  assert.equal((await monitor(h).sweep()).added,0);
  assert.equal((await admin.send('/api/admin/console/ride-integrity')).body.items.length,0);
});

test('a sharing session without an accepted GPS position is not evidence of lost updates',async t=>{
  const h=await harness(t),{customer,driver,admin}=await participants(h);
  const ride=await arrivedRide(customer,driver);
  h.db.prepare('UPDATE location_shares SET sequence=0,position_json=NULL WHERE ride_id=?').run(ride.id);
  h.advance(121_000);
  assert.equal((await monitor(h).sweep()).added,0);
  assert.equal((await admin.send('/api/admin/console/ride-integrity')).body.items.length,0);
});
