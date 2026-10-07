import { check } from '../../shared/errors.mjs';
import { ACCEPTANCE_CATALOG, manualAcceptanceCheck, acceptanceResultInput, effectiveManualResult, canonicalAcceptance } from './domain.mjs';

function summary(checks){
 const result={total:checks.length,passed:0,failed:0,needsRetest:0,notTested:0,criticalTotal:0,criticalPassed:0};
 for(const item of checks){if(item.status==='passed')result.passed++;else if(item.status==='failed')result.failed++;else if(item.status==='needs_retest')result.needsRetest++;else result.notTested++;
  if(item.critical){result.criticalTotal++;if(item.status==='passed')result.criticalPassed++;}}
 result.ready=result.criticalPassed===result.criticalTotal;result.passRate=result.total?result.passed/result.total:null;return result;
}
export function createAdminAcceptanceService({repository,requirePermission,automaticChecks,unitOfWork,tokens,audit,clock}){
 async function canManage(userId){try{await requirePermission(userId,'acceptance.manage');return true;}catch(error){if(error.code==='FORBIDDEN')return false;throw error;}}
 async function view(userId){
  await requirePermission(userId,'acceptance.read');const now=clock(),rows=new Map((await repository.results()).map(row=>[row.checkKey,row]));
  const automatic=await automaticChecks(),checks=ACCEPTANCE_CATALOG.map(item=>{
   if(item.source==='automatic'){
    const state=automatic[item.key]??{passed:false,evidenceRef:'runtime:missing',note:'Automatic evidence is unavailable.'};
    return {...item,status:state.passed?'passed':'failed',storedStatus:null,version:0,evidenceRef:state.evidenceRef,note:state.note,tester:null,testedAt:now,stale:false};
   }
   return {...item,...effectiveManualResult(item,rows.get(item.key),now)};
  });
  const categories=[...new Set(ACCEPTANCE_CATALOG.map(item=>item.category))].map(name=>{const items=checks.filter(item=>item.category===name);return {name,summary:summary(items),items};});
  return {viewerId:userId,serverNow:now,environment:'production',summary:summary(checks),categories,canManage:await canManage(userId),
   history:(await repository.history(50)).map(row=>({...row,tester:row.testerId?{id:row.testerId,name:row.testerName??'Staff member'}:null}))};
 }
 async function record({userId,checkKey,data,key}){
  const item=manualAcceptanceCheck(checkKey);
  check(typeof key==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(key),'INVALID_IDEMPOTENCY_KEY','A unique request key is required.');
  const input=acceptanceResultInput(data),fingerprint=tokens.digest(canonicalAcceptance({checkKey,...input}));
  return unitOfWork(async()=>{
   await requirePermission(userId,'acceptance.read');await requirePermission(userId,'acceptance.manage');
   const previous=await repository.command(userId,key);if(previous){check(previous.fingerprint===fingerprint,'KEY_REUSED','This key belongs to another action.');return {...await view(userId),replayed:true};}
   const current=await repository.get(checkKey),actual=Number(current?.version??0);check(actual===input.expectedVersion,'STALE_VERSION','This acceptance result changed. Refresh before saving another result.');
   const now=clock(),version=actual+1,row={checkKey:item.key,status:input.status,evidenceRef:input.evidenceRef,note:input.note,testerId:userId,testedAt:now,version,updatedAt:now};
   const saved=actual===0?await repository.insert(row):await repository.update(row,actual);check(saved.changes===1,'STALE_VERSION','This acceptance result changed. Refresh before saving another result.');
   await repository.event({id:tokens.id(),...row,createdAt:now});await repository.saveCommand(userId,key,fingerprint,checkKey,now);await audit.record(userId,'admin.acceptance.result',checkKey,now);
   return {...await view(userId),replayed:false};
  });
 }
 return Object.freeze({get:(user)=>unitOfWork(()=>view(user.id)),record});
}
