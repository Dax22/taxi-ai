import test from 'node:test';
import assert from 'node:assert/strict';
import {computeFareAdvisory,COMMISSION_BPS,FARE_ADVISORY_VERSION}
  from '../src/cost-aware-fare.mjs';

const now=1_800_000_000_000;
const policy={
 commissionBps:1000,baseFareKobo:100000,perKmKobo:12000,perMinuteKobo:1000,
 minimumFareKobo:200000,maximumFareKobo:10000000,
 maintenancePerKmKobo:4000,minimumDriverPayKobo:300000,
 fuelMillilitresPer100Km:8000,
};
const route={source:'verified_road',distanceMeters:10000,durationSeconds:1200,estimatedAt:now-10000};
const fuel={source:'approved_reference',priceKoboPerLitre:100000,observedAt:now-86400000};
const quote=other=>computeFareAdvisory({policy,route,fuel,now,...other});
test('fare advisory preserves 10 percent commission and Nigerian kobo arithmetic',()=>{
 const r=quote();
 assert.equal(r.status,'advisory');
 assert.equal(r.version,FARE_ADVISORY_VERSION);
 assert.equal(r.commissionBps,COMMISSION_BPS);
 assert.equal(r.customerFareKobo,470000);
 assert.equal(r.commissionKobo,47000);
 assert.equal(r.estimatedFuelCostKobo,80000);
 assert.equal(r.estimatedMaintenanceCostKobo,40000);
 assert.equal(r.estimatedNetAfterOperatingCostsKobo,303000);
 assert.equal(r.automaticFareChange,false);
 assert.equal(r.requiresTwoPartyAcceptance,true);
});
test('stale or unverified fuel and route data never create a fare',()=>{
 for(const other of [
  {fuel:null},
  {fuel:{...fuel,observedAt:now-8*86400000}},
  {fuel:{...fuel,source:'guess'}},
  {route:{...route,source:'straight_line'}},
  {route:{...route,estimatedAt:now-3600000}},
 ]){
  const r=quote(other);
  assert.equal(r.status,'unavailable');
  assert.equal(r.automaticFareChange,false);
 }
});
test('policy rejects a changed commission; hard ceiling protects users',()=>{
 assert.throws(()=>quote({policy:{...policy,commissionBps:2000}}),/10% commission/);
 const r=quote({policy:{...policy,maximumFareKobo:300000}});
 assert.equal(r.status,'unavailable');
 assert.equal(r.reason,'cost_floor_exceeds_approved_fare_limit');
});
test('input objects are immutable from this calculation and results are deterministic',()=>{
 const before=JSON.stringify([policy,route,fuel]);
 assert.deepEqual(quote(),quote());
 assert.equal(JSON.stringify([policy,route,fuel]),before);
});
