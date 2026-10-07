import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root=new URL('../public/',import.meta.url), modules=new Map();
async function moduleUrl(name){
 if(modules.has(name))return modules.get(name);
 let source=await readFile(new URL(name,root),'utf8');
 for(const match of [...source.matchAll(/from\s+(['"])(.*?)\1/g)]){
  const path=match[2],url=path.startsWith('/shared/')?new URL('../../../packages/shared/src/'+path.slice(8),import.meta.url).href:await moduleUrl(path.replace(/^\.\//,''));
  source=source.replace(match[0],"from '"+url+"'");
 }
 const url='data:text/javascript;base64,'+Buffer.from(source).toString('base64');modules.set(name,url);return url;
}
const pages=await import(await moduleUrl('command-center-pages.mjs'));
const moderation=await import(await moduleUrl('moderation-pages.mjs'));
const insights=await import(await moduleUrl('command-center-insights.mjs'));
const {renderLiveMap}=await import(await moduleUrl('command-center-map.mjs'));
const {formPayload}=await import(await moduleUrl('forms.mjs'));
const {commandRoute}=await import(new URL('../public/command-center-navigation.mjs',import.meta.url));

// Strict structural fixture. This is not a substitute for real browser/layout QA.
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.dataset={};this.handlers={};this.textContent='';this.disabled=false;}
 append(...values){this.children.push(...values.map(value=>typeof value==='string'?Object.assign(new Element('#text'),{textContent:value}):value));}
 replaceChildren(...values){this.children=[];this.append(...values);}
 setAttribute(key,value){this.attributes[key]=String(value);if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);if(key==='name')this.name=value;}
 getAttribute(key){return this.attributes[key];}
 addEventListener(type,fn){this.handlers[type]=fn;}
 get value(){return this.storedValue??(this.tag==='select'?this.children.find(c=>c.tag==='option')?.attributes.value??'':this.attributes.value??'');}
 set value(value){this.storedValue=value;}
 get elements(){return flatten(this).filter(node=>['input','select','textarea','button'].includes(node.tag));}
}
function flatten(node){return [node,...(node.children||[]).flatMap(child=>child?flatten(child):[])];}
const text=node=>flatten(node).map(n=>n.textContent||'').join(' ');
function setup(t){const old=globalThis.document;globalThis.document={createElement:tag=>new Element(tag),createTextNode:s=>Object.assign(new Element('#text'),{textContent:String(s)}),createElementNS:(_,tag)=>new Element(tag)};t.after(()=>{globalThis.document=old;});}
const now=Date.UTC(2026,0,1,12), id='12345678-1234-1234-1234-123456789012';
const actor={id,name:'Test <script>name</script>'},worker={id:'22345678-1234-1234-1234-123456789012',name:'Test courier'};
const item={id,service:'food',status:'placed',createdAt:now,updatedAt:now,customer:actor,worker,store:{id,name:'Test kitchen'},pickup:'Kitchen town',destination:'Delivery town',amountKobo:'350000',paymentMode:'test',paymentStatus:'not_charged'};
const summary={total:1,groups:[{service:'food',paymentMode:'test',transactions:1,completed:0,cancelled:0,active:1,amountKobo:'350000',unknownAmounts:0}],basis:'Source amounts only; not revenue.'};
const route=(path='/admin/transactions')=>({path,query:new URLSearchParams()});
const owner={role:'owner',permissions:['transactions.read','transactions.export','people.read','businesses.read','operations.read','operations.location','work.manage','moderation.read','moderation.manage','cases.support','cases.safety','finance.read']};
const report={items:[item],summary,nextBefore:null};

test('all-service filters and tables render actual rows without interpreting user text as HTML',t=>{
 setup(t);const page=pages.transactions(report,route(),owner),nodes=flatten(page);
 assert.match(text(page),/All transactions/);assert.match(text(page),/Test <script>name<\/script>/);
 assert.ok(!nodes.some(n=>n.tag==='script'));
 for(const name of ['service','status','customerId','workerId','accountId','participation','vehicleCategory','paymentMode','paymentStatus','area','from','to'])assert.ok(nodes.some(n=>n.name===name),name);
 assert.ok(nodes.some(n=>n.attributes.href==='/admin/transactions-export?'));
 assert.ok(!flatten(pages.transactions(report,route(),{permissions:[]})).some(n=>n.attributes.href?.startsWith('/admin/transactions-export')));
});

test('transaction summaries retain distinct participants, child orders and evidence boundaries',t=>{
 setup(t);const data={item,contents:[{name:'Rice',quantity:2,priceKobo:100000}],recipient:{kind:'recipient',name:'Recipient'},checkout:{id,orders:[item],amountKobo:'350000'},vehicle:{},timeline:[{type:'placed',createdAt:now}],fareEvents:[],calls:[],proofOfDelivery:null,deliveryEvents:[],deliveryState:null,evidenceNotice:'No proof is invented.',paymentNotice:'No real charge was recorded.'};
 const page=pages.transactionDetail(data,route(),owner);assert.match(text(page),/Booking customer/);assert.match(text(page),/Recipient/);assert.match(text(page),/Combined food checkout/);assert.match(text(page),/No real charge/);
 assert.ok(flatten(page).some(n=>n.attributes.href?.startsWith('/admin/live/food/')));
 const limited=pages.transactionDetail(data,route(),{permissions:[]});assert.ok(!flatten(limited).some(n=>n.attributes.href?.startsWith('/admin/live/')));
 assert.ok(!flatten(limited).some(n=>n.attributes.href?.startsWith('/admin/work?')));
});

test('person and vendor views separate participation totals and keep private collection coordinates absent',t=>{
 setup(t);const account={...actor,email:'fixture@example.test',createdAt:now,emailVerified:true,restrictedScopes:['driver']};
 const page=pages.personDetail({account,driver:null,transactions:report,lifetime:summary,participation:{customer:summary,worker:{total:0,groups:[]},vendor:summary}},route('/admin/people/'+id),owner);
 for(const label of ['As customer','As driver / courier','As vendor','Review warning / suspension impact'])assert.ok(text(page).includes(label),label);
 const people=pages.people({items:[{...account,driverCapability:true,storeId:id,storeName:'Kitchen'}]},route('/admin/people'));assert.match(text(people),/Customer \+ Driver \/ courier \+ Vendor/);
 const business=pages.businessDetail({store:{id,name:'Kitchen',areaId:'wuse-ii',status:'approved',isOpen:true,restricted:true},menu:[],transactions:report},route('/admin/businesses/'+id),owner);
 assert.match(text(business),/New ordering suspended/);assert.ok(!text(business).includes('latitude'));
});

test('moderation impact removes all-service option with active jobs and converts explicit Nigeria-time deadlines',t=>{
 setup(t);const page=moderation.restrictionImpact({asOf:now,subject:{id,name:'Participant'},subjectType:'account',allowedScopes:['customer','driver','account'],impact:{activeJourneys:1,activeFoodOrders:0,total:1,policy:'Preserve safe active work.'}});
 const form=flatten(page).find(n=>n.tag==='form'),scope=form.elements.find(n=>n.name==='scope');
 assert.ok(!scope.children.some(option=>option.value==='account'));
 const review=form.elements.find(n=>n.name==='reviewAt');review.value='2026-01-02T12:00';
 const expiry=form.elements.find(n=>n.name==='expiresAt');expiry.value='';
 const payload=formPayload(form);assert.equal(payload.reviewAt,Date.UTC(2026,0,2,11));assert.equal(payload.expiresAt,null);assert.equal(payload.subjectId,id);
 assert.ok(form.elements.some(n=>n.name==='confirmation'));assert.ok(form.elements.some(n=>n.name==='caseReference'));
});

test('location view loads no tiles without a deliberate click and never substitutes a marker for missing GPS',t=>{
 setup(t);const absent=renderLiveMap({position:null});assert.match(text(absent),/No shared location/);assert.equal(flatten(absent).filter(n=>n.tag==='image').length,0);
 const page=renderLiveMap({status:'stale',position:{lat:9.08,lng:7.4,capturedAt:now},map:{enabled:true,tiles:'https://tiles.example.test/{z}/{x}/{y}.png'}});
 assert.match(text(page),/Last known, not live/);assert.equal(flatten(page).filter(n=>n.tag==='image').length,0);
 flatten(page).find(n=>n.tag==='button').handlers.click();assert.equal(flatten(page).filter(n=>n.tag==='image').length,9);
 assert.ok(flatten(page).some(n=>n.tag==='circle'&&n.attributes.class.includes('stale')));
});

test('reports, platform, promotions and briefing distinguish configuration and review from execution',t=>{
 setup(t);assert.match(text(insights.savedReports({items:[],notice:'Scheduled email delivery is not enabled.'})),/not enabled/);
 const health=insights.platform({database:{reachable:true},configuration:{maps:'community',calls:'off',payments:'off',passengerRides:{paused:true,coverage:'nigeria'}},externalProviderTests:'Not tested',notice:'Configured is not verified.'});
 assert.match(text(health),/Not recorded/);assert.match(text(health),/Configured is not verified/);
 const drafts=insights.campaigns({items:[],notice:'Planning only.'});assert.match(text(drafts),/no customer discount is activated/);
 const briefing=insights.brief({method:'Deterministic observations',findings:[{text:'1 order needs review.',href:'/admin/transactions'}],observations:{freshAvailabilityRecords:0,overdueReviews:0,foodStageAlerts:[]},limitations:['No refund or sanction was performed.']});assert.match(text(briefing),/No refund or sanction/);
});

test('command routes validate identifiers and retain each permission boundary',()=>{
 for(const [section,permission] of [['people','people.read'],['businesses','businesses.read'],['restrictions','moderation.read'],['platform','platform.read'],['transactions-export','transactions.export']])assert.equal(commandRoute({pathname:'/admin/'+section,search:''}).permission,permission);
 assert.equal(commandRoute({pathname:'/admin/live/food/'+id,search:'?purpose=safety_review'}).permission,'operations.location');
 for(const path of ['/admin/transactions/food/not-an-id','/admin/live/food/'+id+'/extra','/admin/people/'+id+'/extra'])assert.throws(()=>commandRoute({pathname:path,search:''}));
});
