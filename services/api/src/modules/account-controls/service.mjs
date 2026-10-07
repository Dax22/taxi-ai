import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { id, key, version, restrictionInput, listInput, scopesFor, effective, visible } from './domain.mjs';

/** Staff moderation affects new service actions, never historical money or physical handover facts. */
export function createAccountControlsService({repository,requirePermission,unitOfWork,tokens,audit,clock,
  onRestricted=async()=>{},revokeSessions=async()=>{},publish=async()=>{}}){
 const staffFor=async(user,permission='moderation.read')=>{const staff=await requirePermission(user.id,permission);check(scopesFor(staff).length,'FORBIDDEN','No moderation scopes are assigned.');return staff;};
 const scopeAccess=(staff,row)=>check(scopesFor(staff).includes(row.scope),'NOT_FOUND','Restriction not available to this staff role.');
 async function target(type,recordId){check(['account','store'].includes(type),'INVALID_INPUT','Choose an account or store.');id(recordId);const value=await repository.target(type,recordId);check(value,'NOT_FOUND','Account or store not found.');return value;}
 async function independentReviewer(user,row){check(!await repository.owns(user.id,row),'FORBIDDEN','Another authorized staff member must review your own account or store.');}
 async function event(userId,recordId,kind,detail){await repository.event({id:tokens.id(),restrictionId:recordId,actorId:userId,kind,detail,now:clock()});await audit.record(userId,'moderation.'+kind,recordId,clock());}
 async function detail(user,recordId){const staff=await staffFor(user),row=await repository.find(id(recordId));check(row,'NOT_FOUND','Restriction not found.');scopeAccess(staff,row);
  const subject=await target(row.subjectType,row.subjectId);
  return {viewerId:user.id,asOf:clock(),restriction:visible(row,clock(),true),subject,impact:await repository.impact(row.subjectType,row.subjectId,clock()),
    events:(await repository.events(row.id)).map(({detailJson,...entry})=>({...entry,detail:JSON.parse(detailJson)})),appeal:await repository.appeal(row.id),allowedScopes:scopesFor(staff),
    notice:'Notices are available in the affected account. This action does not claim email or push delivery. Active transactions remain subject to their existing fulfilment, safety and payment policies.'};
 }
 async function command(user,commandKey,fingerprint,run,owner=false){key(commandKey);return unitOfWork(async()=>{
  if(!owner)await staffFor(user,'moderation.manage');
  const previous=await repository.command(user.id,commandKey);
  if(previous){check(previous.fingerprint===fingerprint,'KEY_REUSED','This key belongs to another moderation action.');const result=JSON.parse(previous.resultJson);return {...(owner?await ownDetail(user,result.id):await detail(user,result.id)),replayed:true};}
  const recordId=await run();await repository.saveCommand(user.id,commandKey,fingerprint,{id:recordId},clock());
  return {...(owner?await ownDetail(user,recordId):await detail(user,recordId)),replayed:false};
 });}
 async function ownDetail(user,recordId){const row=await repository.find(id(recordId));check(row&&await repository.owns(user.id,row),'NOT_FOUND','Account notice not found.');
  const appeal=await repository.appeal(row.id);
  return {viewerId:user.id,asOf:clock(),restriction:visible(row,clock()),appeal:appeal?{id:appeal.id,status:appeal.status,body:appeal.body,decisionNote:appeal.decisionNote,createdAt:appeal.createdAt,updatedAt:appeal.updatedAt,version:appeal.version}:null};
 }
 const notify=async row=>{const subject=await target(row.subjectType,row.subjectId);await publish([row.subjectType==='store'?subject.ownerId:subject.id]);};
 return Object.freeze({
  verifyRead:async(user,recordId)=>{await detail(user,recordId);},
  summary:async userId=>{const rows=await repository.summary(userId,clock());return {scopes:await repository.activeAccountScopes(userId,clock()),notices:rows.slice(0,20).map(row=>visible(row,clock())),moreNotices:rows.length>20};},
  assertStore:async storeId=>check(!await repository.storeBlocked(storeId,clock()),'STORE_RESTRICTED','This kitchen is temporarily unavailable for new orders. Existing orders remain available for support.'),
  list:(user,query={})=>unitOfWork(async()=>{const staff=await staffFor(user),filter=listInput(query),rows=await repository.list(filter,scopesFor(staff));return {viewerId:user.id,asOf:clock(),items:rows.slice(0,filter.limit).map(row=>visible(row,clock(),true)),allowedScopes:scopesFor(staff),nextBefore:rows.length>filter.limit?`${rows[filter.limit-1].createdAt}.${rows[filter.limit-1].id}`:null};}),
  impact:(user,type,recordId)=>unitOfWork(async()=>{const staff=await staffFor(user,'moderation.manage'),subject=await target(type,recordId);return {viewerId:user.id,asOf:clock(),subject,subjectType:type,allowedScopes:scopesFor(staff).filter(s=>type==='store'?s==='store':s!=='store'),impact:await repository.impact(type,recordId,clock())};}),
  detail:(user,recordId)=>unitOfWork(()=>detail(user,recordId)),
  apply:(user,data,commandKey)=>{const input=restrictionInput(data,null),fingerprint=tokens.digest(JSON.stringify(['moderation.apply',input]));return command(user,commandKey,fingerprint,async()=>{
    restrictionInput(data,clock());const staff=await staffFor(user,'moderation.manage');scopeAccess(staff,input);
    const subject=await target(input.subjectType,input.subjectId),affected=input.subjectType==='store'?subject.ownerId:subject.id;
    check(affected!==user.id,'FORBIDDEN','You cannot apply moderation to your own account or store.');
    const owner=await repository.target('account',affected);
    check(owner&&owner.role!=='admin'&&owner.staffRole!=='owner','FORBIDDEN','Owner access must be managed through the staff-access workflow.');
    if(['driver','vehicle'].includes(input.scope))check(subject.hasDriver,'INVALID_INPUT','The account has no driver capability.');
    if(input.scope==='vendor')check(subject.hasStore,'INVALID_INPUT','The account has no vendor store.');
    const impact=await repository.impact(input.subjectType,input.subjectId,clock());
    check(input.scope!=='account'||input.kind==='warning'||impact.total===0,'ACTIVE_WORK_REVIEW_REQUIRED','This account has active work. Apply a scoped new-work restriction and arrange safe resolution before an all-services suspension.');
    for(const expired of await repository.expired(input.subjectType,input.subjectId,clock()))if(await repository.close(expired.id,expired.version,'expired',user.id,clock()))await event(user.id,expired.id,'expired',{previousVersion:expired.version});
    if(input.kind==='suspension')check(!await repository.activeScope(input.subjectType,input.subjectId,input.scope,clock()),'RESTRICTION_EXISTS','An active restriction already covers this scope. Review it instead of creating a duplicate.');
    const recordId=tokens.id(),now=clock();await repository.insert({...input,id:recordId,actorId:user.id,now});
    await event(user.id,recordId,'applied',{scope:input.scope,kind:input.kind,reasonCode:input.reasonCode,impact,caseReference:input.caseReference});
    if(input.kind==='suspension'){await onRestricted(affected,input.scope,now);if(input.scope==='account')await revokeSessions(affected);}
    await notify(input);return recordId;
  });},
  lift:(user,recordId,data,commandKey)=>{id(recordId);fields(data,['expectedVersion','reason','confirmation']);const expectedVersion=version(data.expectedVersion),reason=label(data.reason,'Reinstatement reason',10,1000);check(data.confirmation==='REINSTATE','INVALID_CONFIRMATION','Type REINSTATE after reviewing the restriction.');return command(user,commandKey,tokens.digest(JSON.stringify(['moderation.lift',recordId,expectedVersion,reason])),async()=>{
    const staff=await staffFor(user,'moderation.manage'),row=await repository.find(recordId);check(row,'NOT_FOUND','Restriction not found.');scopeAccess(staff,row);await independentReviewer(user,row);
    check(row.version===expectedVersion&&row.status==='active','STALE_VERSION','This restriction changed or is already closed.');
    check(await repository.close(recordId,expectedVersion,'lifted',user.id,clock()),'STALE_VERSION','This restriction changed.');await event(user.id,recordId,'lifted',{reason,previousVersion:expectedVersion});await notify(row);return recordId;
  });},
  mine:(user,query={})=>unitOfWork(async()=>{const f=listInput(query);check(!f.subjectType,'INVALID_INPUT','Account notices cannot query other accounts.');const rows=await repository.mine(user.id,f.before,f.limit);return {viewerId:user.id,asOf:clock(),items:rows.slice(0,f.limit).map(row=>visible(row,clock())),nextBefore:rows.length>f.limit?`${rows[f.limit-1].createdAt}.${rows[f.limit-1].id}`:null};}),
  ownDetail:(user,recordId)=>unitOfWork(()=>ownDetail(user,recordId)),
  appeal:(user,recordId,data,commandKey)=>{id(recordId);fields(data,['body']);const body=label(data.body,'Appeal explanation',10,2000);return command(user,commandKey,tokens.digest(JSON.stringify(['moderation.appeal',recordId,body])),async()=>{
    const row=await repository.find(recordId);check(row&&await repository.owns(user.id,row),'NOT_FOUND','Account notice not found.');
    check(row.kind==='suspension'&&effective(row,clock()),'RESTRICTION_CLOSED','Only an effective suspension can be appealed.');
    check(!await repository.appeal(recordId),'APPEAL_EXISTS','An appeal already exists for this restriction.');
    await repository.addAppeal({id:tokens.id(),restrictionId:recordId,userId:user.id,body,now:clock()});await event(user.id,recordId,'appealed',{});return recordId;
  },true);},
  decideAppeal:(user,recordId,data,commandKey)=>{id(recordId);fields(data,['expectedVersion','restrictionVersion','decision','note']);const expectedVersion=version(data.expectedVersion),restrictionVersion=version(data.restrictionVersion),note=label(data.note,'Appeal decision',10,1000);check(['upheld','overturned'].includes(data.decision),'INVALID_INPUT','Choose an appeal outcome.');return command(user,commandKey,tokens.digest(JSON.stringify(['moderation.appeal_decision',recordId,expectedVersion,restrictionVersion,data.decision,note])),async()=>{
    const staff=await staffFor(user,'moderation.manage'),row=await repository.find(recordId);check(row,'NOT_FOUND','Restriction not found.');scopeAccess(staff,row);await independentReviewer(user,row);
    const appeal=await repository.appeal(recordId);check(appeal&&appeal.version===expectedVersion&&appeal.status==='submitted'&&row.version===restrictionVersion,'STALE_VERSION','The appeal or restriction changed.');
    check(await repository.decideAppeal({id:appeal.id,expectedVersion,status:data.decision,note,actorId:user.id,now:clock()}),'STALE_VERSION','The appeal changed.');
    if(data.decision==='overturned'&&row.status==='active')check(await repository.close(recordId,restrictionVersion,'lifted',user.id,clock()),'STALE_VERSION','The restriction changed.');
    await event(user.id,recordId,'appeal_decided',{outcome:data.decision,note});await notify(row);return recordId;
  });},
 });
}
