import test from 'node:test';
import assert from 'node:assert/strict';
import { readFamilyResponse, readFamilyCommandResult, readFamilyTripResponse } from '../src/family.mjs';

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', rideId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const summary=()=>({shareId:id,rideId,version:2,status:'booked',relationship:'watching',name:'Approved passenger',sharingActive:true,
  safeArrivalAt:null,checkIn:null,endedAt:null,canRequestCheckIn:true,canRespond:false,canRequestHelp:false,canConfirmArrival:false});
const active=()=>({trip:{...summary(),passengerName:'Approved passenger',pickup:'Wuse II',destination:'Maitama',
  driver:{name:'Driver',vehicle:{model:'Toyota Corolla',plate:'TEST123',colour:null,category:'standard'}},
  location:{lat:9.08,lng:7.4,accuracy:12,capturedAt:1000,source:'driver_shared',stale:false}},serverNow:1001});
const dashboard=()=>({family:{adultConfirmed:true,contacts:[{id,version:1,status:'active',direction:'watching',name:'Approved passenger',createdAt:0,expiresAt:604800000,canShare:false}],
  trips:[summary()],availableTrips:[],inbox:[{id,shareId:id,kind:'shared',title:'A trip is being shared with you',createdAt:1,state:'saved',acknowledgedAt:null}],
  limits:{contacts:5,checkInCooldownMs:300000}},serverNow:1001});

test('Family Safety contracts read explicit account projections and honest delivery stages',()=>{
  assert.equal(readFamilyResponse(dashboard()).family.trips[0].relationship,'watching');
  const command={...dashboard(),replayed:true}; assert.equal(readFamilyCommandResult(command),command);
  assert.throws(()=>readFamilyCommandResult(dashboard()),/incompatible/);
  assert.equal(readFamilyTripResponse(active()).trip.location.source,'driver_shared');
  const reply=dashboard(); reply.family.inbox[0].delivery={status:'provider_accepted',configured:true,acceptedAt:50,providerConfirmedAt:70,deliveredAt:null};
  assert.equal(readFamilyResponse(reply).family.inbox[0].delivery.deliveredAt,null);
});

test('Family Safety client boundary rejects private ride fields at every projection level',()=>{
  for(const field of ['pickupPin','negotiation','agreement','messages','phone','fareKobo','customerId']) {
    const trip=active(); trip.trip[field]='private'; assert.throws(()=>readFamilyTripResponse(trip),/incompatible/,field);
    const reply=dashboard(); reply.family.trips[0][field]='private'; assert.throws(()=>readFamilyResponse(reply),/incompatible/,field);
  }
  for(const mutate of [r=>r.trip.driver.phone='+2348000000000',r=>r.trip.driver.vehicle.ownerId=id,
    r=>r.trip.location.phoneId=id,r=>r.trip.location.source='passenger_phone',r=>r.trip.location.lat=Infinity]) {
    const trip=active(); mutate(trip); assert.throws(()=>readFamilyTripResponse(trip),/incompatible/);
  }
  const reply=dashboard(); reply.family.inbox[0].location={lat:9,lng:7}; assert.throws(()=>readFamilyResponse(reply),/incompatible/);
});

test('completed family trips allow only a short status summary and passenger arrival acknowledgement',()=>{
  const trip={...summary(),status:'completed',sharingActive:false,endedAt:1000,canRequestCheckIn:false};
  assert.equal(readFamilyTripResponse({trip,serverNow:1001}).trip.safeArrivalAt,null);
  for(const field of ['driver','pickup','destination','location','passengerName']) {
    assert.throws(()=>readFamilyTripResponse({trip:{...trip,[field]:active().trip[field]},serverNow:1001}),/incompatible/,field);
  }
  assert.throws(()=>readFamilyTripResponse({trip:{...trip,canConfirmArrival:true},serverNow:1001}),/incompatible/,'viewer cannot confirm passenger arrival');
  assert.equal(readFamilyTripResponse({trip:{...trip,relationship:'sharing_with',canConfirmArrival:true},serverNow:1001}).trip.canConfirmArrival,true);
});

test('manual help can have no prior check-in request without pretending that a contact acknowledged it',()=>{
  const reply=dashboard(); reply.family.trips[0].checkIn={requestedAt:null,respondedAt:1000,response:'help'};
  assert.equal(readFamilyResponse(reply).family.trips[0].checkIn.requestedAt,null);
  reply.family.inbox[0].state='acknowledged'; assert.throws(()=>readFamilyResponse(reply),/incompatible/);
  reply.family.inbox[0].acknowledgedAt=1001; assert.equal(readFamilyResponse(reply).family.inbox[0].state,'acknowledged');
});
