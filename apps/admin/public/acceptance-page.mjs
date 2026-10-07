import { el, panel, cards, table, detailsList, count, percent, date } from './ui.mjs';
import { actionForm } from './forms.mjs';

const statusLabel=value=>({passed:'Passed',failed:'Failed',needs_retest:'Needs retest',not_tested:'Not tested'})[value]??value;
const statusBadge=value=>el('span',statusLabel(value),`badge acceptance-${value}`);
function checkCard(item,canManage){
 const box=el('article',null,'acceptance-check'),heading=el('div',null,'acceptance-check-heading'),title=el('div');
 title.append(el('h3',item.title),el('p',item.description,'definition-note'));heading.append(title,statusBadge(item.status));box.append(heading);
 box.append(detailsList([
  ['Evidence source',item.source==='automatic'?'Automatic runtime evidence':'Manual production acceptance'],
  ['Critical for readiness',item.critical?'Yes':'No'],
  ['Last verified',date(item.testedAt)],
  ['Tester',item.tester?.name??(item.source==='automatic'?'Runtime':'Not recorded')],
  ['Evidence reference',item.evidenceRef||'Not recorded'],
  ['Freshness',item.source==='automatic'?'Live runtime state':item.maxAgeDays?`${item.maxAgeDays} day verification window`:'No expiry configured'],
 ]));
 if(item.note)box.append(el('p',item.note,'acceptance-note'));
 if(item.stale)box.append(el('p','The saved result was Passed, but its verification window expired. Retest it before treating it as current production evidence.','scope-notice'));
 if(item.source==='manual'&&canManage){
  const controls=el('details',null,'staff-controls'),summary=el('summary',item.version?'Record a new result':'Record first result');controls.append(summary);
  controls.append(actionForm({title:'Production acceptance result',action:`/api/admin/console/acceptance/${item.key}/result`,
   data:{expectedVersion:item.version},submit:'Save acceptance result',fields:[
    {name:'status',label:'Result',options:[['passed','Passed'],['failed','Failed'],['needs_retest','Needs retest']],value:item.status==='not_tested'?'passed':item.status,
      help:'Passed means you personally verified the stated end-to-end behavior. Configuration alone is not sufficient.'},
    {name:'evidenceRef',label:'Evidence reference',min:2,max:200,value:item.evidenceRef,placeholder:'Trip/order ID, provider ticket, test run or evidence label',help:'Use a reference that staff can trace. Do not paste credentials or secrets.'},
    {name:'note',label:'Test note',min:5,max:1000,multiline:true,value:item.note,placeholder:'Devices used, observed result and anything that needs follow-up.'},
   ]}));box.append(controls);
 }
 return box;
}
export function acceptance(data){
 const root=el('div'),ready=data.summary.ready;
 root.append(cards([
  ['Production readiness',ready?'READY':'NOT READY',`${count(data.summary.criticalPassed)} of ${count(data.summary.criticalTotal)} critical checks current`,true],
  ['Passed',count(data.summary.passed),`${percent(data.summary.passRate)} of all checks`],
  ['Needs retest',count(data.summary.needsRetest),'Expired or explicitly marked for another acceptance run'],
  ['Failed / not tested',`${count(data.summary.failed)} / ${count(data.summary.notTested)}`,'Failures and missing evidence remain visible'],
 ]));
 const policy=panel('Acceptance policy',ready?'All critical acceptance evidence is current. Continue monitoring and retest after material provider/mobile changes.':'Taxi Ai is not considered fully production-accepted until every critical check is current and Passed.');
 policy.append(el('p','Automatic checks prove runtime/configuration state only. Real-device, provider-delivery and payment behavior must be recorded separately through manual acceptance checks. A saved Passed result may age into Needs retest without deleting its original evidence.','definition-note'));
 root.append(policy);
 for(const category of data.categories){
  const box=panel(category.name,`${count(category.summary.passed)} of ${count(category.summary.total)} checks currently Passed${category.summary.needsRetest?` · ${count(category.summary.needsRetest)} need retest`:''}.`);
  const list=el('div',null,'acceptance-list');for(const item of category.items)list.append(checkCard(item,data.canManage));box.append(list);root.append(box);
 }
 const history=panel('Acceptance history','Latest 50 manual acceptance decisions. Prior results are retained when a check is retested.');
 history.append(data.history.length?table(['Time','Check','Result','Tester','Evidence','Note'],data.history.map(row=>[
  date(row.createdAt),row.checkKey,statusLabel(row.status),row.tester?.name??'Staff member',row.evidenceRef,row.note
 ]),'Production acceptance evidence history'):el('p','No manual production acceptance result has been recorded yet.','definition-note'));
 root.append(history,el('p',`Environment: ${data.environment}. Updated ${date(data.serverNow)}.`, 'definition-note'));return root;
}
