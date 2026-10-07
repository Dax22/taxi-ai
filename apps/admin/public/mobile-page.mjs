import { el, link, panel, cards, table, detailsList, filterForm, count, percent, date } from './ui.mjs';
import { actionForm } from './forms.mjs';
const ms=value=>value==null?'—':`${Number(value).toFixed(value>=100?0:1)} ms`;
const state=value=>{const node=el('span',value??'unknown',`badge mobile-${value??'unknown'}`);node.textContent=({granted:'Granted',denied:'Denied',unknown:'Unknown'})[value]??String(value??'Unknown');return node;};
function accountCell(device){const box=el('div',null,'person-cell'),info=el('div');info.append(link(device.userName,'/admin/accounts/'+device.userId),el('span',device.email,'subtext'));box.append(info);return box;}
function releaseLabel(device){if(!device.platform||device.nativeBuild==null)return 'Legacy / not reported';return `${device.platform.toUpperCase()} · ${device.appVersion} (${device.nativeBuild})`;}
export function mobile(data,route){
 const root=el('div');root.append(filterForm(route,[{name:'window',label:'API / push window',options:[['24h','Last 24 hours'],['7d','Last 7 days']]},{name:'platform',label:'Device table',options:[['all','iOS + Android'],['ios','iOS'],['android','Android']]}],data.filters));
 root.append(cards([
  ['Active native sessions',count(data.summary.activeDevices),`${count(data.summary.iosDevices)} iOS · ${count(data.summary.androidDevices)} Android · ${count(data.summary.unknownBuildDevices)} unreported`,true],
  ['Latest-build adoption',percent(data.summary.latestAdoption),`${count(data.summary.latestBuildDevices)} of ${count(data.summary.knownDevices)} reporting devices`],
  ['Push registered',percent(data.summary.activeDevices?data.summary.pushRegistered/data.summary.activeDevices:null),`${count(data.summary.pushRegistered)} active device sessions`],
  ['Mobile API p95',ms(data.api.p95),`${percent(data.api.errorRate)} estimated error rate · sampled 1/${count(data.sampleEvery)} successes`],
 ]));
 const release=panel('Release health','Signed build adoption reported by active native sessions. EAS build IDs are non-secret provenance.');
 release.append(detailsList([
  ['Latest iOS native build',data.latestBuilds.ios??'No reporting iPhone yet'],['Minimum iOS build',data.policy.ios.minimumBuild??'Monitor only · not configured'],['Minimum iOS version',data.policy.ios.minimumVersion??'Monitor only · not configured'],
  ['Latest Android native build',data.latestBuilds.android??'No reporting Android yet'],['Minimum Android build',data.policy.android.minimumBuild??'Monitor only · not configured'],['Minimum Android version',data.policy.android.minimumVersion??'Monitor only · not configured'],
  ['Unknown / legacy sessions',count(data.summary.unknownBuildDevices)],['Below configured minimum',count(data.summary.unsupportedDevices)],
 ]));
 release.append(data.builds.length?table(['Platform','App version','Native build','Profile','Active devices','Last seen','EAS build'],data.builds.map(row=>[
  row.platform.toUpperCase(),row.appVersion,count(row.nativeBuild),row.buildProfile??'—',count(row.devices),date(row.lastSeenAt),row.easBuildId?row.easBuildId.slice(0,8).toUpperCase():'—'
 ]),'Active signed-build adoption'):el('p','No installed native build has reported health yet. Data begins after users open the updated signed app.','definition-note'));root.append(release);
 const tracking=panel('Push & active tracking health','Authoritative server state. This view stores no push tokens, GPS history or arbitrary phone logs.');
 const ride=data.tracking.ride,food=data.tracking.food;
 tracking.append(cards([
  ['Ride shares',count(ride.active),`${count(ride.healthy)} recent · ${count(ride.stale)} stale · ${count(ride.expired)} expired`],
  ['Food shares',count(food.active),`${count(food.healthy)} recent · ${count(food.stale)} stale · ${count(food.expired)} expired`],
  ['Background grants',count(data.tracking.backgroundGrants),'Active scoped background-location capabilities'],
  ['Push jobs',count(Object.values(data.push.jobs).reduce((n,row)=>n+row.count,0)),`${count(data.push.jobs.dead?.count??0)} dead · ${count(data.push.jobs.ticket?.count??0)} awaiting receipt`],
 ]));
 tracking.append(el('p','Recent means the active driver/courier share was seen within 30 seconds. Stale is 30–59 seconds. Expired is 60+ seconds and should be investigated; it does not establish where the person is now.','definition-note'));root.append(tracking);
 const api=panel('Mobile API reliability',`Privacy-limited server samples since ${date(data.filters.since)}. Successful requests are sampled; all sampled errors are retained. No request bodies, query values, user IDs or device IDs are stored in API samples.`);
 api.append(detailsList([['Estimated requests',count(data.api.estimatedRequests)],['Sample rows',count(data.api.samples)],['p50 / p95',`${ms(data.api.p50)} / ${ms(data.api.p95)}`],['4xx / 5xx',`${count(data.api.clientErrors)} / ${count(data.api.serverErrors)}`],['Estimated error rate',percent(data.api.errorRate)]]));
 api.append(data.api.byRoute.length?table(['API area','Estimated requests','Errors','Error rate','p95'],data.api.byRoute.map(row=>[row.route,count(row.requests),count(row.errors),percent(row.errorRate),ms(row.p95)]),'Coarse mobile API reliability by route family'):el('p','No mobile API samples are available in this window yet.','definition-note'));root.append(api);
 const devices=panel('Active device fleet',`Latest ${count(data.limits.deviceRows)} active native sessions at most. Permission state is passively observed; Taxi Ai does not turn permissions on remotely.`);
 if(!data.devices.length)devices.append(el('p','No active native device sessions match this filter.','definition-note'));
 else devices.append(table(['Account / device','Release','Last seen','Push','Location','Background','Notifications','Driver online','Action'],data.devices.map(device=>{
   const identity=el('div');identity.append(accountCell(device),el('span',device.deviceName,'subtext'));
   const release=el('div');release.append(el('strong',releaseLabel(device)),el('span',device.osVersion?`OS ${device.osVersion}`:'No OS report','subtext'),el('span',device.easBuildId?`Build ${device.easBuildId.slice(0,8).toUpperCase()}`:'No EAS build report','subtext'));
   let action='—';if(data.canManage){action=actionForm({title:'',action:`/api/admin/console/mobile/devices/${device.sessionId}/revoke`,submit:'Revoke device',danger:true,fields:[]});}
   return[identity,release,date(device.lastSeenAt??device.refreshedAt),device.pushRegistered?'Registered':'Not registered',state(device.locationPermission),state(device.backgroundLocationPermission),state(device.notificationPermission),device.driverOnline?'Yes':'No',action];
 }),'Active native device sessions'));
 devices.append(el('p','Revoking a device ends its native session and removes its push registration. Existing trip/location authorization is revalidated separately and background capabilities are revoked by the database session lifecycle.','definition-note'));root.append(devices);
 return root;
}
