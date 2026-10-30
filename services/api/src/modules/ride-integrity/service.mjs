import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { arrivalGap, arrivalCancellation, GAP_AFTER_ARRIVAL_MS, LOCATION_STALE_MS,
  ARRIVAL_LOCATION_TOLERANCE_MS, SIGNAL_KINDS } from '../../../../../packages/shared/src/ride-integrity.mjs';

const RETENTION_MS = 180 * 24 * 60 * 60_000;
const CANCEL_LOOKBACK_MS = 7 * 24 * 60 * 60_000;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const cursor = value => {
  if (!value) return { beforeAt: null, beforeId: '' };
  const match = value.match(/^(\d{1,16}):([a-f0-9-]{36})$/);
  const beforeAt = Number(match?.[1]);
  check(match && uuid.test(match[2]) && Number.isSafeInteger(beforeAt), 'INVALID_CURSOR', 'Start again from the first page.');
  return { beforeAt, beforeId: match[2] };
};
const summary = row => ({ ...row, label: SIGNAL_KINDS[row.kind],
  interpretation: 'An operational observation requiring human review, not proof of an off-app trip.' });

export function createRideIntegrityService({ repository, requirePermission, unitOfWork, tokens, audit, clock }) {
  async function sweep() {
    return unitOfWork(async () => {
      const now = clock(); let added = 0;
      for (const row of await repository.gapCandidates(now,GAP_AFTER_ARRIVAL_MS,LOCATION_STALE_MS,ARRIVAL_LOCATION_TOLERANCE_MS)) {
        const signal = arrivalGap(row,now);
        if (signal && await repository.insert({ ...signal,id:tokens.id(),rideId:row.rideId,driverId:row.driverId,observedAt:now })) added++;
      }
      for (const row of await repository.cancellationCandidates(now-CANCEL_LOOKBACK_MS)) {
        const signal = arrivalCancellation(row);
        if (signal && await repository.insert({ ...signal,id:tokens.id(),rideId:row.rideId,driverId:row.driverId,observedAt:row.cancelledAt })) added++;
      }
      await repository.purge(now-RETENTION_MS);
      return { added };
    });
  }
  async function list(userId, query = {}) {
    fields(query,['state','before'],[]);
    await requirePermission(userId,'moderation.read');
    const state = query.state ?? 'open';
    check(['all','open','reviewed','dismissed'].includes(state),'INVALID_INPUT','Choose a review state.');
    const result = await repository.list({ state, ...cursor(query.before),limit:51 });
    const page = result.slice(0,50);
    await audit.record(userId,'admin.ride_integrity_listed','ride-integrity',clock());
    return { viewerId:userId,asOf:clock(),items:page.map(summary),nextBefore:result.length>50 ? `${page.at(-1).observedAt}:${page.at(-1).id}`:null,
      notice:'GPS gaps can be caused by coverage, battery, permissions or app shutdown. Cancellation after arrival can be legitimate. Review independently; no automatic driver penalty or payment adjustment is made.' };
  }
  async function get(userId,id) {
    await requirePermission(userId,'moderation.read');
    check(uuid.test(id),'NOT_FOUND','Observation not found.');
    const row=await repository.find(id);check(row,'NOT_FOUND','Observation not found.');
    await audit.record(userId,'admin.ride_integrity_viewed',id,clock());
    return {viewerId:userId,asOf:clock(),signal:summary(row),notice:'This is a review-only observation. Corroborate with passenger and driver accounts and authorized trip evidence.'};
  }
  async function review({userId,id,data,key}) {
    check(uuid.test(id),'NOT_FOUND','Observation not found.');
    check(typeof key==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(key),'INVALID_IDEMPOTENCY_KEY','A unique action key is required.');
    fields(data,['expectedVersion','state','note'],['expectedVersion','state','note']);
    check(Number.isSafeInteger(data.expectedVersion)&&data.expectedVersion>0,'INVALID_VERSION','Refresh the observation before reviewing.');
    check(['open','reviewed','dismissed'].includes(data.state),'INVALID_INPUT','Choose a review outcome.');
    const note=label(data.note,'Review note',10,500);
    const fingerprint=tokens.digest(JSON.stringify([id,data.expectedVersion,data.state,note]));
    return unitOfWork(async()=>{
      await requirePermission(userId,'moderation.manage');
      const previous=await repository.command(userId,key);
      if(previous){check(previous.signalId===id&&previous.fingerprint===fingerprint,'KEY_REUSED','This action key belongs to another review.');
        return {...await get(userId,id),replayed:true};}
      const row=await repository.find(id);check(row,'NOT_FOUND','Observation not found.');
      check(row.version===data.expectedVersion,'STALE_VERSION','Another reviewer changed this observation. Refresh it.');
      check(row.reviewStatus!==data.state,'INVALID_INPUT','Choose a different review outcome.');
      check(await repository.review({id,expectedVersion:data.expectedVersion,state:data.state,note,actorId:userId,now:clock()}),
        'STALE_VERSION','Another reviewer changed this observation.');
      await repository.saveCommand(userId,key,fingerprint,id);
      await audit.record(userId,'admin.ride_integrity_reviewed',id,clock());
      return {viewerId:userId,asOf:clock(),signal:summary(await repository.find(id)),replayed:false};
    });
  }
  return Object.freeze({sweep,list,get,review});
}
