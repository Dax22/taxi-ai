import { check } from '../../shared/errors.mjs';
import { hasCapability } from '../../shared/policies.mjs';
import { deliveryId,deliveryKind,deliveryPhase,deliveryRoute,deliveryNotice,projectDeliveryUpdate } from './domain.mjs';

/** Durable domain events and device delivery use independent leases. External
 * routing and push requests never hold the lifecycle/database transaction. */
export function createDeliveryUpdatesService({ repository,getAccount,targetIds,access,phaseFor,familyTargets,
  validTarget,disableTarget,provider,estimateEta,unitOfWork,tokens,clock,onChanged=async()=>{} }) {
  let running=false,stopped=false,drain=null,resolveDrain=null;
  const actor=async id => {
    const user=await getAccount(id);
    check(hasCapability(user,'customer'),'FORBIDDEN','Sign in to view delivery updates.');
    return user;
  };
  async function accessible(user,kind,targetId) {
    try { return await access(user,kind,targetId); }
    catch(error) { if (['NOT_FOUND','FORBIDDEN','UNAUTHENTICATED'].includes(error?.code)) return null; throw error; }
  }
  async function authorized(row) {
    const user=await getAccount(row.userId);
    return hasCapability(user,'customer') && Boolean(await accessible(user,row.kind,row.targetId));
  }
  async function own(userId,id) {
    check(deliveryId(id),'NOT_FOUND','Delivery update not found.');
    const user=await actor(userId),row=await repository.find(id);
    check(row?.userId === userId,'NOT_FOUND','Delivery update not found.');
    const target=await accessible(user,row.kind,row.targetId);
    check(target,'NOT_FOUND','Delivery update not found.');
    return {row,target};
  }
  // Internal port: callers already hold the transaction that commits pickup,
  // destination arrival or verified handover. Replayed commands cannot duplicate it.
  async function publish({kind,targetId,phase,customerId,eventKey,now=clock(),route=null}) {
    check(deliveryKind(kind) && deliveryId(targetId) && deliveryPhase(phase)
      && typeof eventKey === 'string' && eventKey.length > 0 && eventKey.length <= 240
      && Number.isSafeInteger(now) && now >= 0,'INVALID_INPUT','Invalid delivery milestone.');
    const recipients=[...new Set(await targetIds(kind,targetId,customerId))].sort();
    check(recipients.length <= 50,'INVALID_INPUT','Too many delivery update recipients.');
    const sanitized=phase === 'picked_up' ? deliveryRoute(route) : null,results=[];
    for(const userId of recipients) {
      const user=await getAccount(userId);
      if(!hasCapability(user,'customer') || !await accessible(user,kind,targetId)) continue;
      const id=tokens.id(),notice=deliveryNotice(kind,phase);
      const inserted=await repository.add({id,userId,kind,targetId,phase,eventKey,now,...notice,routeJson:sanitized ? JSON.stringify(sanitized) : null});
      if(inserted) {
        // Only devices that have already opted in get this event; enabling push
        // or registering a new device later must not replay historical notices.
        if(provider?.enabled) for(const target of await familyTargets(userId)) {
          if(await validTarget({...target,userId})) await repository.addPush({id:tokens.id(),updateId:id,userId,...target,now});
        }
        await onChanged([userId]);
      }
      const row=await repository.milestone(userId,kind,targetId,phase);
      if(row) results.push(projectDeliveryUpdate(row));
    }
    return results;
  }
  async function list(userId,before=null) {
    return unitOfWork(async()=>{
      const user=await actor(userId);
      let cursor=null;
      if(before !== null) {
        check(deliveryId(before),'INVALID_CURSOR','Invalid delivery updates cursor.');
        cursor=await repository.find(before);
        check(cursor?.userId === userId,'INVALID_CURSOR','Invalid delivery updates cursor.');
      }
      const rows=await repository.list(userId,cursor),page=rows.slice(0,50),updates=[];
      const permissions=new Map();
      for(const row of page) {
        const key=`${row.kind}:${row.targetId}`;
        if(!permissions.has(key)) permissions.set(key,Boolean(await accessible(user,row.kind,row.targetId)));
        if(permissions.get(key)) updates.push(projectDeliveryUpdate(row));
        else if(row.readAt === null) await repository.read(row.id,clock());
      }
      return {updates,unread:await repository.unread(userId),nextBefore:rows.length > 50 ? page.at(-1).id : null};
    });
  }
  async function forTarget(userId,kind,targetId) {
    check(deliveryKind(kind) && deliveryId(targetId),'NOT_FOUND','Delivery update not found.');
    const user=await actor(userId);
    check(await accessible(user,kind,targetId),'NOT_FOUND','Delivery update not found.');
    return projectDeliveryUpdate(await repository.latest(userId,kind,targetId));
  }
  async function open(userId,id) {
    return unitOfWork(async()=>{
      const {row,target}=await own(userId,id);
      check(['food-order','journey','parcels'].includes(target.screen) && target.id === row.targetId,'NOT_FOUND','Delivery update not found.');
      await repository.read(row.id,clock());
      await onChanged([userId]);
      return {target:{screen:target.screen,id:target.id}};
    });
  }
  async function read(userId,id) {
    return unitOfWork(async()=>{const {row}=await own(userId,id);await repository.read(row.id,clock());await onChanged([userId]);return {read:true};});
  }
  async function enrichPending() {
    for(const row of await repository.dueEta(clock())) {
      if(stopped) break;
      const claimed=await unitOfWork(()=>repository.claimEta(row.id,row.etaAttempts,clock()));
      if(stopped) break;
      if(!claimed) continue;
      let estimate=null;
      // Frozen pickup coordinates are used only while the pickup notice remains
      // timely. Arrival/completion and revoked recipients never trigger routing.
      if(row.etaAttempts < 3 && clock() < row.createdAt+300_000 && await authorized(row)
        && await phaseFor(row.kind,row.targetId) === 'picked_up') {
        if(stopped) break;
        try { estimate=await estimateEta(JSON.parse(row.routeJson)); } catch { estimate=null; }
      }
      if(stopped) break;
      const seconds=estimate?.source === 'road' && Number.isFinite(estimate.durationSeconds)
        && estimate.durationSeconds > 0 && estimate.durationSeconds <= 172800 ? estimate.durationSeconds : null;
      await unitOfWork(async()=>{
        const current=await phaseFor(row.kind,row.targetId);
        const minutes=current === 'picked_up' && await authorized(row) && seconds ? Math.max(1,Math.ceil(seconds/60)) : null;
        if(await repository.finishEta(row.id,row.etaAttempts+1,clock(),deliveryNotice(row.kind,row.phase,minutes))) await onChanged([row.userId]);
      });
    }
  }
  async function eligible(job,row) {
    return row && await authorized(row) && await validTarget(job)
      && (job.status === 'ticket' || await phaseFor(row.kind,row.targetId) === row.phase);
  }
  async function finish(job,attempts,status,nextAt=clock(),ticket=job.ticket) {
    return repository.finishPush(job.id,attempts,status,nextAt,ticket);
  }
  async function sendPending() {
    if(!provider?.enabled) return;
    for(const job of await repository.duePush(clock())) {
      if(stopped) break;
      const attempts=job.attempts+1;
      let row;
      const claimed=await unitOfWork(async()=>{
        if(!await repository.claimPush(job.id,job.attempts,clock())) return false;
        row=await repository.find(job.updateId);
        if(!await eligible(job,row)) { await finish(job,attempts,'suppressed');return false; }
        const ttl=job.status === 'ticket' || row.phase === 'delivered' ? 86_400_000 : 300_000;
        if(job.attempts >= 8 || clock() >= job.createdAt+ttl) { await finish(job,attempts,'failed');return false; }
        return true;
      });
      if(stopped) break;
      if(!claimed) continue;
      // Revalidate both account-bound recipient grants and this device's opt-in
      // immediately before external I/O. Tickets only poll a provider receipt.
      if(!await eligible(job,row)) {
        if(stopped) break;
        await unitOfWork(async()=>{if(await repository.ownsPush(job.id,attempts,clock())) await finish(job,attempts,'suppressed');});
        continue;
      }
      if(stopped) break;
      let result;
      try { result=job.status === 'ticket' && job.ticket ? await provider.receipt(job.ticket)
        : await provider.send({token:job.token,deliveryUpdateId:row.id,deliveryTitle:row.title,deliveryBody:row.body}); }
      catch { result={status:'retry'}; }
      if(stopped) break;
      await unitOfWork(async()=>{
        if(!await repository.ownsPush(job.id,attempts,clock())) return;
        if(!await eligible(job,row)) { await finish(job,attempts,'suppressed');return; }
        if(result?.status === 'unregistered') await disableTarget(job.token);
        if(['ok','delivered'].includes(result?.status)) await finish(job,attempts,'done');
        else if(result?.status === 'ticket' && typeof result.ticket === 'string' && result.ticket.length > 0 && result.ticket.length <= 1000) {
          await finish(job,attempts,'ticket',clock()+15*60_000,result.ticket);
        } else if(['unregistered','error'].includes(result?.status)) await finish(job,attempts,'failed');
        else await finish(job,attempts,job.status,clock()+Math.min(60_000*2**job.attempts,3_600_000));
      });
    }
  }
  async function deliverPending() {
    if(stopped || running) return;
    running=true;drain=new Promise(resolve=>{resolveDrain=resolve;});
    try { await enrichPending();if(!stopped) await sendPending(); }
    finally { running=false;resolveDrain();resolveDrain=null;drain=null; }
  }
  return Object.freeze({publish,list,forTarget,open,read,deliverPending,stop:()=>{stopped=true;return drain ?? Promise.resolve();}});
}
