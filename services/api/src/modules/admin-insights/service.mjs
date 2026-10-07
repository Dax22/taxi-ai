import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { summaryInput, reportInput, campaignInput, commandKey, id } from './domain.mjs';

export function createAdminInsightsService({repository,requirePermission,readSummary,validateFilters,configuration,unitOfWork,audit,tokens,clock}) {
 const run=(user,permission,read)=>unitOfWork(async()=>{await requirePermission(user.id,permission);return {...await read(clock()),viewerId:user.id,asOf:clock()};});
 async function save(user,permission,key,fingerprint,write){commandKey(key);return run(user,permission,async now=>{
  const previous=await repository.command(user.id,key);if(previous){check(previous.fingerprint===fingerprint,'KEY_REUSED','This key belongs to another action.');return {...JSON.parse(previous.resultJson),replayed:true};}
  const result=await write(now);await repository.saveCommand(user.id,key,fingerprint,result,now);return {...result,replayed:false};
 });}
 return Object.freeze({
  summary:(user,query)=>run(user,'analytics.read',async now=>({summary:await readSummary(summaryInput(query),now),filters:query,cohort:'Transaction creation dates in Africa/Lagos; present status, not a historical balance.'})),
  brief:(user)=>run(user,'operations.read',async now=>{
   const observations=await repository.operationalCounts(now);
   return {observations,method:'Deterministic rules over stored records; no external AI model or autonomous action.',
    findings:[{text:`${observations.waitingRequests} unexpired request(s) are waiting.`,href:'/admin/transactions?status=requested'},
     {text:`${observations.activeFoodOrders} food order(s) are active.`,href:'/admin/transactions?service=food&status=active'},
     {text:`${observations.foodStageAlerts.reduce((n,r)=>n+r.count,0)} food order(s) have not changed stage in 30 minutes. Investigate; this does not establish fault.`,href:'/admin/transactions?service=food&status=active'}],
    limitations:['Fresh availability records are not a nearby eligible-driver count.','The 30-minute alert is an operational rule, not a delivery promise.','No sanction, refund or dispatch was performed.']};
  }),
  platform:user=>run(user,'platform.read',async()=>({database:{reachable:await repository.healthy()},configuration:configuration(),
   externalProviderTests:'Not run by this page',lastPhoneCallTest:null,lastEndToEndDeliveryTest:null,
   notice:'Configured is not verified. No credential values, provider secrets or personal records are returned.'})),
  reports:user=>run(user,'reports.manage',async()=>({items:(await repository.reports(user.id)).map(({filtersJson,...row})=>({...row,filters:JSON.parse(filtersJson)})),scheduledDeliveryAvailable:false,notice:'Saved report filters are reusable. Scheduled email delivery is not enabled.'})),
  saveReport:(user,data,key)=>{
   const input=reportInput(data);validateFilters(input.filters,clock());const fingerprint=tokens.digest(JSON.stringify(['report.save',input]));
   return save(user,'reports.manage',key,fingerprint,async now=>{check((await repository.reports(user.id)).length<100,'INVALID_INPUT','At most 100 saved reports per staff account.');const recordId=tokens.id();await repository.saveReport({...input,id:recordId,userId:user.id,now});await audit.record(user.id,'admin.report_saved',recordId,now);return {id:recordId};});
  },
  removeReport:(user,recordId,data,key)=>{
   id(recordId);fields(data,['expectedVersion']);const version=Number(data.expectedVersion);check(Number.isSafeInteger(version)&&version>0,'INVALID_VERSION','Refresh the report.');
   return save(user,'reports.manage',key,tokens.digest(JSON.stringify(['report.remove',recordId,version])),async now=>{check(await repository.deleteReport(user.id,recordId,version),'STALE_VERSION','This report changed or is not owned by you.');await audit.record(user.id,'admin.report_removed',recordId,now);return {id:recordId,removed:true};});
  },
  campaigns:user=>run(user,'growth.manage',async()=>({items:await repository.campaigns(),redemptionAvailable:false,notice:'Planning drafts only. No discount has been applied, no budget spent, and no customer offer published.'})),
  saveCampaign:(user,data,key)=>{
   const input=campaignInput(data);return save(user,'growth.manage',key,tokens.digest(JSON.stringify(['campaign.save',input])),async now=>{check((await repository.campaigns()).length<100,'INVALID_INPUT','At most 100 campaign drafts.');const recordId=tokens.id();await repository.saveCampaign({...input,id:recordId,userId:user.id,now});await audit.record(user.id,'admin.campaign_drafted',recordId,now);return {id:recordId};});
  },
  archiveCampaign:(user,recordId,data,key)=>{
   id(recordId);fields(data,['expectedVersion']);const version=Number(data.expectedVersion);check(Number.isSafeInteger(version)&&version>0,'INVALID_VERSION','Refresh the campaign.');
   return save(user,'growth.manage',key,tokens.digest(JSON.stringify(['campaign.archive',recordId,version])),async now=>{check(await repository.archiveCampaign(recordId,version,now),'STALE_VERSION','This draft changed.');await audit.record(user.id,'admin.campaign_archived',recordId,now);return {id:recordId,archived:true};});
  },
  accessAudit:(user,input={})=>run(user,'audit.read',async()=>{fields(input,['before','limit'],[]);const before=Number(input.before||Number.MAX_SAFE_INTEGER),limit=Number(input.limit||50);check(Number.isSafeInteger(before)&&before>0&&Number.isInteger(limit)&&limit>0&&limit<=100,'INVALID_INPUT','Invalid audit page.');const rows=await repository.audit(before,limit);return {items:rows.slice(0,limit),nextBefore:rows.length>limit?String(rows[limit-1].id):null};}),
 });
}
