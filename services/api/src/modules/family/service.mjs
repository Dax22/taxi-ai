import { check } from '../../shared/errors.mjs';
import { hasCapability } from '../../shared/policies.mjs';
import { fields, emailAddress } from '../../shared/validation.mjs';
import { transportCategory } from '../../../../../packages/shared/src/transport-categories.mjs';
import { ACTIVE_TRIP_STATUSES, FAMILY_LIMIT, INVITATION_TTL, ARRIVAL_TTL, CHECK_IN_COOLDOWN,
  RESPONSE_COOLDOWN, identifier, canonical, version, contactStatus, shareVisible, EVENT_TITLES } from './domain.mjs';

/** Account membership never grants fares, pickup PINs, chat, booking, cancellation or payment authority. */
export function createFamilyService({ repository, getAccount, getAccountByEmail, getTrip, listTrips,
  locationForTrip, unitOfWork, tokens, audit, clock, publish = async () => {},
  enqueue = async () => {}, deliveryFor = async () => null, onHelp = async () => {} }) {
  const actor = async id => { const user = await getAccount(id); check(user, 'UNAUTHENTICATED', 'Sign in to use Family Safety.'); check(hasCapability(user,'customer'),'FORBIDDEN','A customer account is required for Family Safety.'); return user; };
  const activeTrip = ride => ACTIVE_TRIP_STATUSES.includes(ride.status);
  const ownSelfTrip = (ride,userId) => ride?.customerId === userId && ride.passenger?.kind !== 'guest'
    && transportCategory(ride.vehicleCategory ?? ride.driver?.vehicle?.category ?? 'standard')?.service === 'ride';
  const adult = async (id, consent, now) => {
    check(consent === true, 'INVALID_INPUT', 'Confirm you are 18 or older to use adult Family Safety.');
    await repository.confirmAdult(id,now);
  };
  async function context(row) { return await getTrip(await actor(row.ownerId),row.rideId); }
  async function emit({userId,contactId,shareId=null,kind,dedupeKey,now}) {
    const id=tokens.id();
    if (await repository.addEvent({id,userId,contactId,shareId,kind,title:EVENT_TITLES[kind],dedupeKey,now})) await enqueue(id,userId);
  }
  async function notifyShares(rows,kind,key,now,{owner=true,observers=true}={}) {
    const owners=new Set(), touched=new Set();
    for (const row of rows) {
      if (row.contactStatus !== 'active') continue;
      if (observers) { await emit({userId:row.observerId,contactId:row.contactId,shareId:row.id,kind,dedupeKey:`${key}:${row.id}:observer`,now}); touched.add(row.observerId); }
      if (owner && !owners.has(row.ownerId)) {
        owners.add(row.ownerId); await emit({userId:row.ownerId,contactId:row.contactId,shareId:row.id,kind,dedupeKey:`${key}:owner`,now}); touched.add(row.ownerId);
      }
    }
    await publish([...touched],now);
  }
  async function permittedShare(userId,id,{live=false}={}) {
    check(identifier(id),'NOT_FOUND','Shared trip not found.');
    const row=await repository.share(id);
    check(row && [row.ownerId,row.observerId].includes(userId) && shareVisible(row,clock()),'NOT_FOUND','Shared trip not found.');
    const ride=await context(row);
    check(ownSelfTrip(ride,row.ownerId),'NOT_FOUND','Shared trip not found.');
    check(activeTrip(ride) && row.active || ride.status==='completed' && row.reason==='completed'
      && clock() < row.endedAt+ARRIVAL_TTL,'NOT_FOUND','Shared trip not found.');
    if(live) check(Boolean(row.active) && activeTrip(ride),'LINK_CLOSED','This trip is no longer being shared live.');
    return {row,ride};
  }
  async function summary(row,userId,ride) {
    const now=clock(), isOwner=row.ownerId===userId, other=await getAccount(isOwner?row.observerId:row.ownerId);
    const sharingActive=Boolean(row.active) && activeTrip(ride);
    const pending=Boolean(row.requestedAt!=null && (row.respondedAt==null || row.requestedAt>row.respondedAt));
    return {shareId:row.id,version:row.version,rideId:row.rideId,status:ride.status,
      relationship:isOwner?'sharing_with':'watching',name:other?.name ?? 'Family member',sharingActive,
      endedAt:row.endedAt,safeArrivalAt:row.safeArrivalAt,
      checkIn:row.requestedAt!=null||row.respondedAt!=null?{requestedAt:row.requestedAt,respondedAt:row.respondedAt,response:row.response}:null,
      canRequestCheckIn:!isOwner && sharingActive && (row.requestedAt==null || now>=row.requestedAt+CHECK_IN_COOLDOWN),
      canRespond:isOwner && sharingActive && (pending || row.respondedAt==null || now>=row.respondedAt+RESPONSE_COOLDOWN),
      canRequestHelp:isOwner && sharingActive && (row.response!=='help' || row.respondedAt==null || now>=row.respondedAt+RESPONSE_COOLDOWN),
      canConfirmArrival:isOwner && ride.status==='completed' && row.reason==='completed' && row.safeArrivalAt==null && now<row.endedAt+ARRIVAL_TTL};
  }
  async function eventVisible(event,userId) {
    if(!event || event.userId!==userId) return false;
    const contact=await repository.contact(event.contactId);
    if(!contact || ![contact.ownerId,contact.observerId].includes(userId)) return false;
    if(event.shareId) {
      const row=await repository.share(event.shareId);
      return Boolean(shareVisible(row,clock()) || event.kind==='cancelled' && row?.contactStatus==='active'
        && row.reason==='cancelled' && clock()<row.endedAt+ARRIVAL_TTL);
    }
    return ['pending','active'].includes(contactStatus(contact,clock()));
  }
  async function canDeliver(eventId,userId) { return await eventVisible(await repository.event(eventId),userId); }
  async function dashboard(userId) {
    const user=await actor(userId),now=clock(),confirmed=await repository.adult(userId), contacts=[];
    for(const row of await repository.contacts(userId)) {
      const direction=row.ownerId===userId?'sharing_with':'watching',status=contactStatus(row,now);
      const other=direction==='watching'?await getAccount(row.ownerId):status==='active'?await getAccount(row.observerId):null;
      contacts.push({id:row.id,version:row.version,status,direction,name:other?.name ?? row.invitedEmail,
        createdAt:row.createdAt,expiresAt:row.expiresAt,canShare:direction==='sharing_with'&&status==='active'&&confirmed});
    }
    const trips=[];
    for(const row of await repository.shares(userId,now)) {
      if(!shareVisible(row,now)) continue;
      const ride=await context(row);
      if(ownSelfTrip(ride,row.ownerId) && (activeTrip(ride)&&row.active || ride.status==='completed'&&row.reason==='completed')) trips.push(await summary(row,userId,ride));
    }
    const availableTrips=[];
    if(confirmed) for(const ride of await listTrips(user)) if(ownSelfTrip(ride,userId)&&activeTrip(ride))
      availableTrips.push({rideId:ride.rideId,status:ride.status,pickup:ride.pickup,destination:ride.destination});
    const inbox=[];
    for(const row of await repository.events(userId)) if(await eventVisible(row,userId)) {
      const delivery=await deliveryFor(row.id,userId);
      inbox.push({id:row.id,shareId:row.kind==='cancelled'?null:row.shareId,kind:row.kind,title:row.title,createdAt:row.createdAt,
        state:row.acknowledgedAt==null?'saved':'acknowledged',acknowledgedAt:row.acknowledgedAt,...(delivery?{delivery}:{})});
      if(inbox.length===50) break;
    }
    return {family:{adultConfirmed:confirmed,contacts,trips,availableTrips,inbox,limits:{contacts:FAMILY_LIMIT,checkInCooldownMs:CHECK_IN_COOLDOWN}},serverNow:now};
  }
  async function get(userId) { return await unitOfWork(async()=>{ await actor(userId); await repository.lockUsers([userId]); await repository.expireContacts(userId,clock()); return await dashboard(userId); }); }
  async function trip(userId,shareId) {
    return await unitOfWork(async()=>{
      await actor(userId); const initial=await repository.share(shareId);
      check(initial && [initial.ownerId,initial.observerId].includes(userId),'NOT_FOUND','Shared trip not found.');
      await repository.lockUsers([initial.ownerId,initial.observerId]);
      const {row,ride}=await permittedShare(userId,shareId), projected=await summary(row,userId,ride);
      if(!projected.sharingActive) return {trip:projected,serverNow:clock()};
      const point=await locationForTrip(row.rideId), vehicle=ride.driver.vehicle;
      return {trip:{...projected,passengerName:(await actor(row.ownerId)).name,pickup:ride.pickup,destination:ride.destination,
        driver:{name:ride.driver.name,vehicle:{model:vehicle.model,plate:vehicle.plate,colour:vehicle.colour??null,category:vehicle.category}},
        location:point?{lat:point.lat,lng:point.lng,accuracy:point.accuracy,capturedAt:point.capturedAt,source:'driver_shared',stale:Boolean(point.stale)}:null},serverNow:clock()};
    });
  }
  async function command({userId,action,data,key}) {
    check(typeof key==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(key),'INVALID_IDEMPOTENCY_KEY','A unique request key is required.');
    check(data && typeof data==='object'&&!Array.isArray(data),'INVALID_BODY','Send a JSON object.');
    const fingerprint=tokens.digest(canonical({action,data}));
    return await unitOfWork(async()=>{
      const user=await actor(userId), now=clock(); let contact=null,initial=null,recipient=null;
      if(action==='invite') { fields(data,['email','adultConfirmed']); const email=emailAddress(data.email); recipient=await getAccountByEmail(email); }
      for(const field of ['contactId','shareId','eventId']) if(Object.hasOwn(data,field)) check(identifier(data[field]),'INVALID_INPUT','Use a valid Family Safety identifier.');
      if(data.contactId) contact=await repository.contact(data.contactId);
      if(data.shareId) { initial=await repository.share(data.shareId); if(initial) contact=await repository.contact(initial.contactId); }
      await repository.lockUsers([userId,contact?.ownerId,contact?.observerId,recipient?.id]);
      const previous=await repository.command(userId,key);
      if(previous) { check(previous.fingerprint===fingerprint,'KEY_REUSED','This request key belongs to another Family Safety action.'); return {...await dashboard(userId),replayed:true}; }
      await repository.expireContacts(userId,now);
      if(contact) contact=await repository.contact(contact.id);
      if(action==='invite') {
        const email=emailAddress(data.email); await adult(userId,data.adultConfirmed,now);
        check(email!==user.email && recipient?.id!==userId,'INVALID_INPUT','Invite another adult account.');
        check(await repository.countOutgoing(userId)<FAMILY_LIMIT,'FAMILY_LIMIT','You can have up to five active or pending Family Safety contacts.');
        check(!await repository.openContact(userId,email),'FAMILY_EXISTS','An invitation or connection already exists for this email.');
        const id=tokens.id(); await repository.addContact({id,ownerId:userId,observerId:recipient?.id??null,email,now,expiresAt:now+INVITATION_TTL});
        if(recipient) await emit({userId:recipient.id,contactId:id,kind:'invitation',dedupeKey:`invite:${id}`,now});
        await publish([userId,recipient?.id].filter(Boolean),now);
      } else if(['accept','decline','revoke-contact'].includes(action)) {
        fields(data,action==='accept'?['contactId','expectedVersion','adultConfirmed']:['contactId','expectedVersion']);
        check(contact && [contact.ownerId,contact.observerId].includes(userId),'NOT_FOUND','Family contact not found.'); version(contact,data.expectedVersion);
        if(action==='accept'||action==='decline') {
          check(contact.observerId===userId && contact.status==='pending','NOT_FOUND','Family invitation not found.');
          if(action==='accept') { await adult(userId,data.adultConfirmed,now); check(await repository.countWatching(userId)<FAMILY_LIMIT,'FAMILY_LIMIT','You can follow up to five approved adults.'); }
          await repository.updateContact(contact.id,action==='accept'?'active':'declined',now);
          if(action==='accept') await emit({userId:contact.ownerId,contactId:contact.id,kind:'accepted',dedupeKey:`accepted:${contact.id}`,now});
        } else {
          check(['active','pending'].includes(contact.status),'LINK_CLOSED','This family connection has ended.');
          await repository.updateContact(contact.id,'revoked',now);
          for(const row of await repository.contactShares(contact.id)) await repository.endShare(row.id,'revoked',now);
        }
        await publish([contact.ownerId,contact.observerId].filter(Boolean),now);
      } else if(action==='share') {
        fields(data,['rideId','contactId']);
        check(contact?.ownerId===userId && contact.status==='active','NOT_FOUND','Approved family contact not found.');
        check(await repository.adult(userId),'FORBIDDEN','Confirm adult Family Safety participation first.');
        check(identifier(data.rideId),'NOT_FOUND','Ride not found.'); await repository.lockRide(data.rideId);
        const ride=await getTrip(user,data.rideId);
        check(ownSelfTrip(ride,userId)&&activeTrip(ride),'LINK_CLOSED','Share a confirmed, active ride where you are the passenger.');
        check(!await repository.existingShare(contact.id,data.rideId),'FAMILY_EXISTS','You are already sharing this trip with this contact.');
        const id=tokens.id(); await repository.addShare({id,contactId:contact.id,rideId:data.rideId,ownerId:userId,observerId:contact.observerId,now});
        const row=await repository.share(id); await notifyShares([row],'shared',`shared:${id}`,now);
      } else if(['stop-sharing','request-check-in','respond'].includes(action)) {
        fields(data,action==='respond'?['shareId','expectedVersion','response']:['shareId','expectedVersion']);
        check(initial && [initial.ownerId,initial.observerId].includes(userId),'NOT_FOUND','Shared trip not found.');
        await repository.lockRide(initial.rideId);
        const {row,ride}=await permittedShare(userId,data.shareId,{live:action==='request-check-in'}); version(row,data.expectedVersion);
        if(action==='stop-sharing') {
          await repository.revokeShare(row.id,now); await publish([row.ownerId,row.observerId],now);
        } else if(action==='request-check-in') {
          check(row.observerId===userId,'FORBIDDEN','Only an approved viewer can request a check-in.');
          check(row.requestedAt==null||now>=row.requestedAt+CHECK_IN_COOLDOWN,'FAMILY_COOLDOWN','Please wait five minutes between check-in requests.');
          await repository.requestCheckIn(row.rideId,now); await repository.updateShares(row.rideId);
          const rows=await repository.rideShares(row.rideId); await notifyShares(rows,'check_in',`checkin:${row.rideId}:${now}`,now);
        } else {
          check(row.ownerId===userId,'FORBIDDEN','Only the passenger can send this response.');
          check(['okay','help','arrived'].includes(data.response),'INVALID_INPUT','Choose a valid check-in response.');
          if(data.response==='arrived') {
            check(ride.status==='completed'&&row.reason==='completed'&&now<row.endedAt+ARRIVAL_TTL,'LINK_CLOSED','Confirm safe arrival within 24 hours after the driver completes your trip.');
            check(row.safeArrivalAt==null,'LINK_CLOSED','You already confirmed safe arrival.');
          } else {
            check(row.active&&activeTrip(ride),'LINK_CLOSED','Check-ins are available while the trip is shared live.');
            const pending=row.requestedAt!=null&&(row.respondedAt==null||row.requestedAt>row.respondedAt);
            check(data.response==='help'&&row.response!=='help'||pending||row.respondedAt==null||now>=row.respondedAt+RESPONSE_COOLDOWN,'FAMILY_COOLDOWN','Please wait a minute before sending another check-in.');
          }
          await repository.respond(row.rideId,data.response,now); await repository.updateShares(row.rideId);
          await notifyShares(await repository.visibleRideShares(row.rideId,now),data.response==='arrived'?'safe_arrival':data.response,`response:${row.rideId}:${data.response}:${now}`,now);
          if(data.response==='help') await onHelp({userId,rideId:row.rideId,now});
        }
      } else if(action==='acknowledge') {
        fields(data,['eventId']); const event=await repository.event(data.eventId);
        check(await eventVisible(event,userId),'NOT_FOUND','Family update not found.');
        await repository.acknowledge(event.id,now); await publish([userId],now);
      } else check(false,'NOT_FOUND','Family Safety action not found.');
      await repository.saveCommand(userId,key,fingerprint,now); await audit.record(userId,`family.${action}`,userId,now);
      return {...await dashboard(userId),replayed:false};
    });
  }
  /** Called inside ride transaction. Completing a trip ends GPS access atomically. */
  async function onRideEvent({rideId,kind,status,now=clock(),eventKey}) {
    const mapped=status??({confirm:'booked',depart:'on_way',arrive:'arrived',start:'in_progress',complete:'completed',cancel:'cancelled'}[kind]??kind);
    if(![...ACTIVE_TRIP_STATUSES,'completed','cancelled'].includes(mapped)) return;
    const rows=await repository.rideShares(rideId); if(!rows.length) return;
    if(['completed','cancelled'].includes(mapped)) for(const row of rows) await repository.endShare(row.id,mapped,now);
    else await repository.updateShares(rideId);
    await notifyShares(rows,mapped,eventKey??`journey:${rideId}:${mapped}`,now);
  }
  async function onLocationEvent(rideId,now=clock()) {
    const rows=(await repository.rideShares(rideId)).filter(row=>row.contactStatus==='active');
    await publish([...new Set(rows.flatMap(row=>[row.ownerId,row.observerId]))],now);
  }
  async function sweep() {
    return await unitOfWork(async()=>{
      const now=clock(), rows=await repository.expiredContacts(now), touched=[];
      await repository.lockUsers(rows.flatMap(row=>[row.ownerId,row.observerId]));
      for(const row of rows) if(await repository.expireContact(row.id,now)) touched.push(row.ownerId,row.observerId);
      await publish([...new Set(touched.filter(Boolean))],now);
    });
  }
  return Object.freeze({get,trip,command,onRideEvent,onLocationEvent,canDeliver,dispatchable:canDeliver,sweep});
}
