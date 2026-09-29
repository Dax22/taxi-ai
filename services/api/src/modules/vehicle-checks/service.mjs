import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { compareVehicle } from './domain.mjs';
import { VEHICLE_PHOTO_CONSENT } from '../../../../../packages/shared/src/vehicle-checks.mjs';

const active = status => ['booked','on_way','arrived'].includes(status);
export function createVehicleChecksService({ repository, provider, codec, getAccount, getTrip, sessionOwner, nativeSessionOwner, unitOfWork, tokens, clock }) {
  async function context(input,rideId) {
    const user = (await getAccount(input.userId));
    const owner = input.nativeSessionId ? (await nativeSessionOwner(input.nativeSessionId))
      : typeof input.sessionToken === 'string' ? (await sessionOwner(tokens.digest(input.sessionToken))) : null;
    check(user && owner === user.id,'UNAUTHENTICATED','Sign in to check your pickup vehicle.');
    const ride = (await getTrip(user,rideId));
    check(ride.customerId === user.id,'NOT_FOUND','Pickup vehicle check not found.');
    return ride;
  }
  const sweep = async () => (await unitOfWork(async () => (await repository.sweep(clock()))));
  function project(row,ride) {
    return { id:row.id,rideId:row.rideId,createdAt:row.createdAt,expiresAt:row.expiresAt,
      outcome:row.state === 'complete' ? JSON.parse(row.resultJson).outcome : row.state,
      fields:row.resultJson ? JSON.parse(row.resultJson).fields : [], reasons:row.resultJson ? JSON.parse(row.resultJson).reasons : [],
      current:active(ride.status) && clock()-row.createdAt<300_000 };
  }
  async function list(input,rideId) {
    const ride = (await context(input,rideId)); (await sweep());
    return { rideId, enabled:provider.enabled, provider:provider.provider, canCheck:provider.enabled && active(ride.status),
      consentVersion:VEHICLE_PHOTO_CONSENT, checks:(await repository.list(input.userId,rideId)).map(row => project(row,ride)) };
  }
  async function analyse(input,rideId,data,key) {
    (await context(input,rideId));
    fields(data,['image','consentVersion']);
    check(data.consentVersion === VEHICLE_PHOTO_CONSENT,'INVALID_CONSENT','Agree to photo analysis before sending the image.');
    check(typeof key === 'string' && /^[a-f0-9-]{36}$/.test(key),'INVALID_KEY','Use a unique photo-check request key.');
    const decoded = codec.decode(data.image), fingerprint = tokens.digest(`${rideId}:${data.consentVersion}:${decoded.sha256}`);
    const reservation = (await unitOfWork(async () => {
      (await repository.sweep(clock()));
      const ride = (await context(input,rideId)), previous = (await repository.command(input.userId,key));
      if (previous) { check(previous.fingerprint === fingerprint,'KEY_REUSED','This key belongs to another photo check.'); return { row:previous,replayed:true }; }
      check(provider.enabled,'VISION_DISABLED','Photo checks are not configured. Compare the plate and vehicle yourself.');
      check(active(ride.status),'INVALID_TRIP_STATE','Photo checks are available before pickup on your assigned trip.');
      const limits = (await repository.limits(input.userId,rideId,clock()-3_600_000));
      check(limits.actor < 10 && limits.trip < 5 && limits.total < 100,'RATE_LIMITED','Photo check limit reached. Compare the vehicle yourself or report a concern.');
      check(limits.pending < 2,'VISION_BUSY','Photo checks are busy. Try again shortly.');
      const id = tokens.id();
      (await repository.add({ id,rideId,ownerId:input.userId,key,fingerprint,expected:ride.driver.vehicle,
        model:provider.model,consentVersion:data.consentVersion,now:clock() }));
      return { row:(await repository.find(id)),replayed:false };
    }));
    if (reservation.replayed) return { check:project(reservation.row,(await context(input,rideId))),replayed:true };
    let result = null, failure = null;
    try {
      const image = await codec.normalise(decoded.content);
      const ride = (await context(input,rideId));
      check(active(ride.status),'INVALID_TRIP_STATE','The trip has already left pickup.');
      result = compareVehicle(JSON.parse(reservation.row.expectedJson),await provider.analyse(image));
    } catch (error) { failure = error; }
    // Both upload decoding and provider I/O can outlive an account or trip. Never
    // return an old account result or a new positive result after pickup ended.
    let ride;
    try { ride = (await context(input,rideId)); }
    catch (error) { (await unitOfWork(async () => (await repository.finish(reservation.row.id,'unavailable',null,clock())))); throw error; }
    return (await unitOfWork(async () => {
      const state = !active(ride.status) ? 'trip_ended' : failure ? 'unavailable' : 'complete';
      (await repository.finish(reservation.row.id,state,state === 'complete' ? result : null,clock()));
      return { check:project((await repository.find(reservation.row.id)),ride),replayed:false };
    }));
  }
  // Called by safety within its transaction. Only an explicit owner report
  // preserves a result in that incident; raw photos are never stored.
  async function evidence(userId,rideId,id) {
    const row = (await repository.find(id));
    check(row && row.ownerId === userId && row.rideId === rideId && row.expiresAt>clock() && row.state === 'complete',
      'NOT_FOUND','Completed photo check not found.');
    return { id:row.id,checkedAt:row.createdAt,model:row.model,comparison:JSON.parse(row.resultJson) };
  }
  return Object.freeze({ list,analyse,evidence,sweep });
}
