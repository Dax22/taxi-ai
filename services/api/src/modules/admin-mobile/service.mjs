import { check } from '../../shared/errors.mjs';
import { mobileFilters,mobileSessionId,mobileCommandKey } from './domain.mjs';
const number=value=>Number(value??0);
const semver=value=>String(value??'').split(/[+-]/)[0].split('.').map(v=>Number(v));
function compareVersion(a,b){const x=semver(a),y=semver(b);for(let i=0;i<3;i++){if((x[i]??0)!==(y[i]??0))return(x[i]??0)-(y[i]??0);}return 0;}
function weightedPercentile(rows,p){const sorted=[...rows].sort((a,b)=>a.durationMs-b.durationMs),total=sorted.reduce((n,r)=>n+r.sampleWeight,0);if(!total)return null;let seen=0,target=Math.ceil(total*p);for(const row of sorted){seen+=row.sampleWeight;if(seen>=target)return row.durationMs;}return sorted.at(-1)?.durationMs??null;}
function apiSummary(rows){
 const total=rows.reduce((n,r)=>n+number(r.sampleWeight),0),client=rows.filter(r=>r.statusCode>=400&&r.statusCode<500).reduce((n,r)=>n+r.sampleWeight,0),server=rows.filter(r=>r.statusCode>=500).reduce((n,r)=>n+r.sampleWeight,0);
 const byRoute=[...new Set(rows.map(r=>r.routeClass))].sort().map(route=>{const subset=rows.filter(r=>r.routeClass===route),requests=subset.reduce((n,r)=>n+r.sampleWeight,0),errors=subset.filter(r=>r.statusCode>=400).reduce((n,r)=>n+r.sampleWeight,0);return{route,requests,errors,errorRate:requests?errors/requests:null,p95:weightedPercentile(subset,.95)};});
 return{estimatedRequests:total,clientErrors:client,serverErrors:server,errorRate:total?(client+server)/total:null,p50:weightedPercentile(rows,.5),p95:weightedPercentile(rows,.95),samples:rows.length,byRoute};
}
function supported(device,policy){if(!device.platform||device.nativeBuild==null)return null;const p=policy[device.platform];if(!p)return null;if(p.minimumBuild!==null&&Number(device.nativeBuild)<p.minimumBuild)return false;if(p.minimumVersion&&compareVersion(device.appVersion,p.minimumVersion)<0)return false;return true;}
export function createAdminMobileService({repository,requirePermission,unitOfWork,audit,clock,releasePolicy,sampleEvery}){
 async function canManage(userId){try{await requirePermission(userId,'mobile.manage');return true;}catch(error){if(error.code==='FORBIDDEN')return false;throw error;}}
 async function get(userId,query={}){
  await requirePermission(userId,'mobile.read');const filters=mobileFilters(query),now=clock(),since=now-(filters.window==='7d'?7:1)*24*60*60_000;
  const [rawSummary,rawDevices,builds,pushJobs,tracking,samples,manage]=await Promise.all([repository.summary(now),repository.devices(now,500),repository.builds(now),repository.pushJobs(since),repository.tracking(now),repository.apiSamples(since,5000),canManage(userId)]);
  const allDevices=rawDevices.map(row=>({...row,pushRegistered:Boolean(row.pushRegistered),driverOnline:Boolean(row.driverOnline),nativeBuild:row.nativeBuild==null?null:Number(row.nativeBuild),supported:supported(row,releasePolicy)}));
  const devices=filters.platform==='all'?allDevices:allDevices.filter(row=>row.platform===filters.platform);
  const known=devices.filter(d=>d.platform&&d.nativeBuild!==null),latest={};
  for(const platform of ['ios','android']){const rows=builds.filter(row=>row.platform===platform);latest[platform]=rows.length?Math.max(...rows.map(row=>Number(row.nativeBuild))):null;}
  const latestKnown=known.filter(d=>latest[d.platform]!==null&&d.nativeBuild===latest[d.platform]).length;
  const unsupported=known.filter(d=>d.supported===false).length;
  const push=Object.fromEntries(pushJobs.map(row=>[row.status,{count:number(row.count),attempts:number(row.attempts)}]));
  return{viewerId:userId,serverNow:now,filters:{...filters,since},canManage:manage,policy:releasePolicy,sampleEvery,
    summary:{activeDevices:number(rawSummary.activeDevices),reportingDevices:number(rawSummary.reportingDevices),iosDevices:number(rawSummary.iosDevices),androidDevices:number(rawSummary.androidDevices),unknownBuildDevices:number(rawSummary.activeDevices)-number(rawSummary.reportingDevices),pushRegistered:number(rawSummary.pushRegistered),knownDevices:known.length,latestBuildDevices:latestKnown,latestAdoption:known.length?latestKnown/known.length:null,unsupportedDevices:unsupported},
    latestBuilds:latest,builds:builds.map(row=>({...row,nativeBuild:Number(row.nativeBuild),devices:number(row.devices)})),devices,
    push:{registered:number(rawSummary.pushRegistered),jobs:push},tracking:{ride:Object.fromEntries(Object.entries(tracking.ride).map(([k,v])=>[k,number(v)])),food:Object.fromEntries(Object.entries(tracking.food).map(([k,v])=>[k,number(v)])),backgroundGrants:number(tracking.background)},
    api:apiSummary(samples),limits:{deviceRows:500,apiSamples:5000}};
 }
 async function revoke({userId,sessionId,key}){mobileSessionId(sessionId);mobileCommandKey(key);return unitOfWork(async()=>{
   await requirePermission(userId,'mobile.read');await requirePermission(userId,'mobile.manage');const previous=await repository.command(userId,key);
   if(previous){check(previous.sessionId===sessionId,'KEY_REUSED','This request key belongs to another device.');return{revoked:true,replayed:true};}
   const device=await repository.findDevice(sessionId);check(device,'NOT_FOUND','Native device session not found.');const now=clock();await repository.revokeDevice(sessionId,now);await repository.unregisterPush(sessionId);await repository.saveCommand(userId,key,sessionId,now);await audit.record(userId,'admin.mobile.device_revoke',sessionId,now);return{revoked:true,replayed:false};
  });}
 return Object.freeze({get,revoke});
}
