const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const only=(value,keys)=>Object.keys(value).every(key=>keys.includes(key));
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const nullableInteger=value=>value===null||integer(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const text=(value,max=254)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f-\u009f]/u.test(value);
const active=['booked','on_way','arrived','in_progress'];
const summaries=['shareId','version','rideId','status','relationship','name','sharingActive','safeArrivalAt','checkIn','endedAt','canRequestCheckIn','canRespond','canRequestHelp','canConfirmArrival'];
function expect(ok) { if(!ok) throw new Error('Taxi Ai returned an incompatible Family Safety response. Refresh and try again.'); }
function readSummary(value,{detail=false}={}) {
  expect(object(value)&&only(value,detail?[...summaries,'passengerName','pickup','destination','driver','location']:summaries)
    &&uuid(value.shareId)&&uuid(value.rideId)&&integer(value.version)&&[...active,'completed','cancelled'].includes(value.status)
    &&['sharing_with','watching'].includes(value.relationship)&&text(value.name)&&typeof value.sharingActive==='boolean'
    &&nullableInteger(value.safeArrivalAt)&&nullableInteger(value.endedAt)
    &&['canRequestCheckIn','canRespond','canRequestHelp','canConfirmArrival'].every(key=>typeof value[key]==='boolean'));
  const state=value.checkIn;
  expect(state===null||object(state)&&only(state,['requestedAt','respondedAt','response'])&&nullableInteger(state.requestedAt)
    &&nullableInteger(state.respondedAt)&&[null,'okay','help','arrived'].includes(state.response));
  expect(!value.sharingActive||active.includes(value.status));
  expect(!value.canRequestCheckIn||value.relationship==='watching'&&value.sharingActive);
  expect(!value.canRespond||value.relationship==='sharing_with'&&value.sharingActive);
  expect(!value.canRequestHelp||value.relationship==='sharing_with'&&value.sharingActive);
  expect(!value.canConfirmArrival||value.relationship==='sharing_with'&&value.status==='completed'&&!value.sharingActive&&value.safeArrivalAt===null);
  return value;
}
function readEvent(event) {
  expect(object(event)&&only(event,['id','shareId','kind','title','createdAt','state','acknowledgedAt','delivery'])&&uuid(event.id)
    &&(event.shareId===null||uuid(event.shareId))&&text(event.kind,40)&&text(event.title,160)&&integer(event.createdAt)
    &&['saved','acknowledged'].includes(event.state)&&nullableInteger(event.acknowledgedAt)
    &&(event.state==='acknowledged')===(event.acknowledgedAt!==null));
  if(event.delivery!==undefined) {
    const d=event.delivery;
    expect(object(d)&&only(d,['status','configured','acceptedAt','providerConfirmedAt','deliveredAt'])
      &&['saved','queued','provider_accepted','delivered','failed','suppressed'].includes(d.status)&&typeof d.configured==='boolean'
      &&nullableInteger(d.acceptedAt)&&nullableInteger(d.providerConfirmedAt)&&nullableInteger(d.deliveredAt));
  }
}
/** Explicit response allowlists protect the observer boundary on both web and native clients. */
export function readFamilyResponse(value) {
  expect(object(value)&&only(value,['family','serverNow','apiVersion','replayed'])&&integer(value.serverNow)
    &&(value.apiVersion===undefined||value.apiVersion===1)&&(value.replayed===undefined||typeof value.replayed==='boolean'));
  const f=value.family;
  expect(object(f)&&only(f,['adultConfirmed','contacts','trips','availableTrips','inbox','limits'])&&typeof f.adultConfirmed==='boolean'
    &&Array.isArray(f.contacts)&&f.contacts.length<=50&&Array.isArray(f.trips)&&f.trips.length<=100
    &&Array.isArray(f.availableTrips)&&f.availableTrips.length<=50&&Array.isArray(f.inbox)&&f.inbox.length<=50
    &&object(f.limits)&&only(f.limits,['contacts','checkInCooldownMs'])&&f.limits.contacts===5&&f.limits.checkInCooldownMs===300000);
  for(const c of f.contacts) expect(object(c)&&only(c,['id','version','status','direction','name','createdAt','expiresAt','canShare'])
    &&uuid(c.id)&&integer(c.version)&&['pending','active','declined','revoked','expired'].includes(c.status)
    &&['sharing_with','watching'].includes(c.direction)&&text(c.name)&&integer(c.createdAt)&&integer(c.expiresAt)
    &&typeof c.canShare==='boolean'&&(!c.canShare||c.direction==='sharing_with'&&c.status==='active'&&f.adultConfirmed));
  for(const trip of f.trips) readSummary(trip);
  for(const trip of f.availableTrips) expect(object(trip)&&only(trip,['rideId','status','pickup','destination'])
    &&uuid(trip.rideId)&&active.includes(trip.status)&&text(trip.pickup,240)&&text(trip.destination,240));
  f.inbox.forEach(readEvent); return value;
}
export function readFamilyCommandResult(value) { readFamilyResponse(value); expect(typeof value.replayed==='boolean'); return value; }
export function readFamilyTripResponse(value) {
  expect(object(value)&&only(value,['trip','serverNow','apiVersion'])&&integer(value.serverNow)&&(value.apiVersion===undefined||value.apiVersion===1));
  const trip=readSummary(value.trip,{detail:true});
  if(!trip.sharingActive) { expect(only(trip,summaries)); return value; }
  expect(text(trip.passengerName)&&text(trip.pickup,240)&&text(trip.destination,240)&&object(trip.driver)&&only(trip.driver,['name','vehicle'])&&text(trip.driver.name));
  const vehicle=trip.driver.vehicle;
  expect(object(vehicle)&&only(vehicle,['model','plate','colour','category'])&&text(vehicle.model,100)&&text(vehicle.plate,30)
    &&(vehicle.colour===null||text(vehicle.colour,100))&&text(vehicle.category,40));
  const p=trip.location;
  expect(p===null||object(p)&&only(p,['lat','lng','accuracy','capturedAt','source','stale'])&&Number.isFinite(p.lat)&&p.lat>=-90&&p.lat<=90
    &&Number.isFinite(p.lng)&&p.lng>=-180&&p.lng<=180&&Number.isFinite(p.accuracy)&&p.accuracy>=0&&p.accuracy<=10000
    &&integer(p.capturedAt)&&p.source==='driver_shared'&&typeof p.stale==='boolean'); return value;
}
