export const commandSections={
 'safety-alerts':['Safety alerts','Possible crash, loud distress and manual panic reports.','cases.safety','safetyAlerts'],
 transactions:['All transactions','Every ride, kitchen order and parcel delivery.','transactions.read','transactions'],
 'transactions-export':['Transaction export','Export the complete filtered cohort.','transactions.export','transactionExport'],
 investigations:['Investigation evidence','Case-specific trip, location, fare and driver disclosures.','investigations.read','investigations'],
 people:['People','Customers, passengers, drivers and couriers.','people.read','people'],
 businesses:['Businesses','Restaurants, vendors and private kitchens.','businesses.read','businesses'],
 work:['Operational reviews','Assigned reviews and response targets.','work.manage','workItems'],
 live:['Transaction location','Audited access to the latest shared location.','operations.location','liveTransaction'],
 diagnosis:['Matching evidence','Explain recorded outcomes.','operations.read','diagnosis'],
 insights:['All-service analytics','Source amounts are not platform revenue.','analytics.read','insights'],
 matching:['Matching intelligence','Fast matching, rider wait and ML shadow outcomes.','operations.read','matching'],
 mobile:['Mobile operations','Native app fleet, release adoption, push, tracking and API health.','mobile.read','mobile'],
 acceptance:['Production acceptance','Real-device and provider evidence for launch readiness.','acceptance.read','acceptance'],
 brief:['Operations briefing','Evidence-linked operational observations.','operations.read','brief'],
 platform:['Platform health','Configuration and acceptance tests are distinct.','platform.read','platform'],
 reports:['Saved reports','Run saved filters against fresh records.','reports.manage','savedReports'],
 campaigns:['Promotion drafts','Planning only; no customer offer is activated.','growth.manage','campaigns'],
 'access-audit':['Sensitive access','Location and export audit trail.','audit.read','accessAudit'],
 restrictions:['Account restrictions','Scoped restrictions, warnings and appeals.','moderation.read','restrictions'],
 'restriction-impact':['Review restriction impact','Inspect active work first.','moderation.manage','restrictionImpact'],
};
export function commandRoute(location){
 const path=location.pathname.replace(/\/$/,''),parts=path.split('/').slice(2),section=parts[0],meta=commandSections[section];
 if(!meta)return null;
 const uuid=value=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value||'');
 let name=meta[3],title=meta[0];
 if(['live','diagnosis'].includes(section)||section==='transactions'&&parts.length>1){
  if(parts.length!==3||!['ride','courier','food'].includes(parts[1])||!uuid(parts[2]))throw new Error('Choose a valid transaction.');
  if(section==='transactions'){name='transactionDetail';title='Transaction summary';}
 }else if(parts.length===2&&['people','businesses','work','restrictions','safety-alerts'].includes(section)&&uuid(parts[1])){
  name={people:'personDetail',businesses:'businessDetail',work:'workDetail',restrictions:'restrictionDetail','safety-alerts':'safetyAlertDetail'}[section];title=meta[0]+' details';
 }else if(parts.length!==1)throw new Error('This dashboard page does not exist.');
 const query=new URLSearchParams(location.search);
 return {path,query,section,name,permission:meta[2],title,description:meta[1],apiPath:'/api/admin/console/'+parts.join('/')+(query.size?'?'+query:'')};
}
