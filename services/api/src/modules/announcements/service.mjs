import { check } from '../../shared/errors.mjs';
import { ANNOUNCEMENT_AUDIENCES, ANNOUNCEMENT_PRIORITIES, announcementAction, announcementDraft, announcementId } from './domain.mjs';

const HOURS = 60 * 60_000;
const project = (row) => ({ id: row.id, title: row.title, body: row.body, audience: row.audience, priority: row.priority,
  status: row.status, version: row.version, createdAt: row.createdAt, publishedAt: row.publishedAt ?? null,
  expiresAt: row.expiresAt, readAt: row.readAt ?? null });

export function createAnnouncementsService({ repository, requirePermission, provider, validPushTarget, disablePushTarget,
  unitOfWork, tokens, audit, clock }) {
  let running=false,stopped=false;
  async function admin(user) {
    return unitOfWork(async()=>{
      const staff=await requirePermission(user.id,'announcements.manage'),now=clock();
      return {viewerId:user.id,asOf:now,pushEnabled:Boolean(provider.enabled),staffRole:staff.role,
        audiences:ANNOUNCEMENT_AUDIENCES,priorities:ANNOUNCEMENT_PRIORITIES,items:(await repository.adminList()).map(project)};
    });
  }
  async function create(user,data,key) {
    const input=announcementDraft(data);
    check(typeof key==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(key),'INVALID_IDEMPOTENCY_KEY','A unique request key is required.');
    const fingerprint=tokens.digest(JSON.stringify(['create',input]));
    return unitOfWork(async()=>{
      await requirePermission(user.id,'announcements.manage');
      const previous=await repository.command(user.id,key);
      if(previous){check(previous.fingerprint===fingerprint,'KEY_REUSED','This request key belongs to another announcement action.');return {saved:true,replayed:true};}
      const now=clock(),id=tokens.id();
      await repository.create({...input,id,createdBy:user.id,createdAt:now,expiresAt:now+input.expiresInHours*HOURS});
      await repository.saveCommand(user.id,key,fingerprint,now);await audit.record(user.id,'admin.announcement_created',id,now);
      return {saved:true,id,replayed:false};
    });
  }
  async function command(user,id,action,data,key) {
    id=announcementId(id);const input=announcementAction(action,data,key),fingerprint=tokens.digest(JSON.stringify([action,id,input]));
    return unitOfWork(async()=>{
      await requirePermission(user.id,'announcements.manage');const previous=await repository.command(user.id,key);
      if(previous){check(previous.fingerprint===fingerprint,'KEY_REUSED','This request key belongs to another announcement action.');return {saved:true,replayed:true};}
      const row=await repository.find(id);check(row,'NOT_FOUND','Announcement not found.');const now=clock();
      check(row.version===input.expectedVersion,'STALE_VERSION','This announcement changed. Refresh before trying again.');
      if(action==='publish'){
        check(row.status==='draft','INVALID_STATE','Only a draft announcement can be published.');
        check(row.expiresAt>now,'INVALID_STATE','This announcement has already expired. Create a new draft.');
        check(await repository.publish(id,user.id,input.expectedVersion,now),'STALE_VERSION','This announcement changed. Refresh before trying again.');
        await repository.enqueuePush(id,row.audience,now);await audit.record(user.id,'admin.announcement_published',id,now);
      }else{
        check(['draft','published'].includes(row.status),'INVALID_STATE','This announcement is already closed.');
        check(await repository.cancel(id,input.expectedVersion,now),'STALE_VERSION','This announcement changed. Refresh before trying again.');
        await repository.cancelPush(id,now);await audit.record(user.id,'admin.announcement_cancelled',id,now);
      }
      await repository.saveCommand(user.id,key,fingerprint,now);return {saved:true,replayed:false};
    });
  }
  async function forUser(userId) {
    const now=clock(),items=(await repository.visible(userId,now)).map(project);
    return {items,unread:items.filter(item=>item.readAt===null).length,asOf:now};
  }
  async function read(userId,id) {
    id=announcementId(id);return unitOfWork(async()=>{
      const now=clock(),item=await repository.visibleOne(id,userId,now);check(item,'NOT_FOUND','Announcement not found.');
      await repository.markRead(id,userId,now);return {read:true,id};
    });
  }
  async function deliverPending() {
    if(stopped||running||!provider.enabled)return;running=true;
    try{
      for(const job of await repository.due(clock())){
        if(stopped)break;
        const valid=async()=>await repository.jobActive(job.id)&&job.announcementStatus==='published'&&clock()<job.expiresAt
          && await validPushTarget({userId:job.userId,sessionId:job.sessionId,token:job.token});
        if(!await valid()||job.attempts>=8){
          await unitOfWork(()=>repository.finish(job.id,'dead',clock(),null,job.attempts));continue;
        }
        if(!await unitOfWork(()=>repository.lease(job.id,clock(),job.attempts)))continue;
        const claimed=job.attempts+1;let result;
        try{result=job.status==='ticket'?await provider.receipt(job.ticket):await provider.send({token:job.token,announcementId:job.announcementId,
          announcementTitle:job.title,announcementBody:job.body,announcementPriority:job.priority});}
        catch{result={status:'retry'};}
        if(stopped)break;
        await unitOfWork(async()=>{
          if(!await repository.ownsLease(job.id,claimed))return;
          if(!await valid()){await repository.finish(job.id,'dead',clock(),null,claimed);return;}
          if(result.status==='unregistered')await disablePushTarget(job.token);
          const status=result.status==='ok'?'done':result.status==='ticket'?'ticket':['unregistered','error'].includes(result.status)?'dead':job.status;
          await repository.finish(job.id,status,clock()+(status==='ticket'?15*60_000:Math.min(60_000*2**job.attempts,3600_000)),result.ticket??job.ticket,claimed);
        });
      }
    }finally{running=false;}
  }
  return Object.freeze({admin,create,command,forUser,read,deliverPending,stop(){stopped=true;}});
}
