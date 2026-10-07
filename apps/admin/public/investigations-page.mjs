import { el, link, panel, detailsList, table, date } from './ui.mjs';
import { actionForm } from './forms.mjs';
const basis=[['court_order','Court order'],['warrant','Search / disclosure warrant'],['documented_police_request','Verified written police request'],
 ['urgent_safety','Documented urgent safety need'],['internal_investigation','Internal investigation (not yet for police disclosure)']];
export function investigations(data,route){
 const root=el('div'),record=data.record;
 const scope=panel('Restricted investigation evidence export',
  'Owner-only: one recorded ride, parcel delivery or food order at a time. Generated ZIP includes a file-hash manifest and an audit receipt.');
 scope.append(el('p','Check identity, legal authority and the necessity of each information category before disclosure. An internal incident reference does not itself authorize police access. Taxi Ai does not automatically send these files to police.', 'scope-notice'));
 scope.append(el('p','GPS evidence warning: the planned booking route is NOT a historical trace. Taxi Ai now retains a sampled active-trip GPS evidence trail for 180 days; exporting that trail requires a separate explicit authorization choice.', 'definition-note'));
 if(record)scope.append(detailsList([['Record',`${record.service.toUpperCase()} · ${record.id}`],['Current status',record.status],
  ['Customer',record.customerName],['Assigned driver/courier',record.workerName??'Not assigned'],
  ['Driver documents currently stored',record.driverDocumentsAvailable],['Historical GPS fixes currently available',record.locationEvidenceAvailable??0],['Recorded at',date(record.createdAt)]]));
 root.append(scope);
 const request=actionForm({title:'Generate case-specific evidence ZIP',action:'/api/admin/console/investigations/export',submit:'Verify authorization & prepare ZIP',fields:[
  {name:'service',label:'Transaction category',options:[['ride','Passenger ride'],['courier','Parcel delivery'],['food','Food order']],value:route.query.get('service')??record?.service??'ride'},
  {name:'transactionId',label:'Transaction UUID',min:36,max:36,value:route.query.get('transactionId')??record?.id??''},
  {name:'caseReference',label:'Official / internal case number',min:5,max:100,placeholder:'Case or incident reference (do not use a person’s name)'},
  {name:'requestingAuthority',label:'Police unit, agency, or internal investigator',min:4,max:160},
  {name:'legalBasis',label:'Authority for processing/disclosure',options:basis},
  {name:'authorityReference',label:'Warrant, order or request document reference',min:4,max:160,
   help:'Record the document/reference and verify it through official channels. This field does not verify authorization automatically.'},
  {name:'purpose',label:'What incident is being investigated and what information is necessary?',min:20,max:800,multiline:true},
  {name:'includeDocuments',label:'Include stored driver licence, selfie and vehicle document images?',options:[['no','No — metadata / hashes only (recommended)'],['yes','Yes — sensitive originals are necessary and authorized']]},
  {name:'includeMessages',label:'Include ride / courier chat text?',options:[['no','No — do not export private messages'],['yes','Yes — message text is necessary and authorized']]},
  {name:'includeLocation',label:'Include retained sampled historical GPS fixes?',options:[['no','No — planned pickup/destination only'],['yes','Yes — historical GPS is necessary and authorized']]},
  {name:'acknowledged',label:'I have verified authority, scope and secure handover procedures',options:[['no','Not yet verified'],['yes','Confirmed — authorized investigator reviewed the request']]},
 ]});
 const box=panel('Prepare an export','Only the requested sensitive sections are included. A new export is logged each time.');
 box.append(request,el('p','Save the ZIP to approved encrypted evidence storage. Record its SHA-256 receipt in the case file and log the receiving officer, transfer time and secure channel. Never email an unencrypted evidence ZIP.', 'definition-note'));root.append(box);
 if(data.history?.length){const history=panel('Past evidence access','Each prior export is recorded with its source case reference and package digest. The stored audit log does not contain the original ZIP bytes.');
  history.append(table(['Exported','Case','Agency/team','Authority','Sensitive scopes','Export ID','Archive SHA-256'],data.history.map(item=>[
   date(item.createdAt),item.caseReference,item.requestingAuthority,item.legalBasis,
   [item.includedLocation?'GPS':null,item.includedMessages?'chat':null,item.includedDocuments?'documents':null].filter(Boolean).join(', ')||'None',item.id,item.archiveSha256
  ]),'Investigation export audit receipts'));root.append(history);}
 root.append(link('Return to transactions','/admin/transactions','button quiet'));
 return root;
}
