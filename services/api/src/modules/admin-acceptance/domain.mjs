import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';

const DAY=24*60*60_000;
export const ACCEPTANCE_CATALOG=Object.freeze([
  {key:'platform.postgres',category:'Platform',title:'PostgreSQL/PostGIS production database',description:'Production is using the current writable PostgreSQL/PostGIS schema.',source:'automatic',critical:true},
  {key:'platform.fast_matching',category:'Platform',title:'Fast matching pilot',description:'Fast candidate discovery is enabled only for the controlled Abuja pilot region.',source:'automatic',critical:true},
  {key:'platform.ml_shadow',category:'Platform',title:'ML ranking shadow mode',description:'ML scores production candidates but cannot choose the live driver.',source:'automatic',critical:true},
  {key:'accounts.google_web_configured',category:'Providers',title:'Google web sign-in configured',description:'Web OAuth is configured. This is configuration evidence, not a real-device acceptance test.',source:'automatic',critical:false},
  {key:'providers.push_configured',category:'Providers',title:'Push notification provider configured',description:'The production push provider is enabled. Background delivery still requires a real-device test.',source:'automatic',critical:true},
  {key:'providers.call_relay_configured',category:'Providers',title:'Masked audio relay configured',description:'Hosted calling uses a configured relay. A real two-phone audio test is still required.',source:'automatic',critical:true},
  {key:'providers.paystack_live_configured',category:'Providers',title:'Live Paystack configured',description:'Live Paystack collection is explicitly enabled. A real low-value payment test is still required.',source:'automatic',critical:true},
  {key:'providers.native_google_configured',category:'Providers',title:'Native Google OAuth configured',description:'At least one iOS/Android OAuth client ID is configured. Native app acceptance remains manual.',source:'automatic',critical:false},
  {key:'rides.two_phone_e2e',category:'Rides',title:'Real two-phone ride',description:'A real rider and real driver complete request → match → negotiate → pickup PIN → trip → completion.',source:'manual',critical:true,maxAgeDays:7},
  {key:'rides.push_background',category:'Rides',title:'Background push notifications',description:'Ride request, accepted, arriving and arrived notifications are received while the app is backgrounded/closed.',source:'manual',critical:true,maxAgeDays:14},
  {key:'rides.masked_audio',category:'Rides',title:'In-app masked audio',description:'Rider and driver can call during an active ride and the call capability ends after the transaction.',source:'manual',critical:true,maxAgeDays:14},
  {key:'rides.live_payment',category:'Rides',title:'Real low-value ride payment',description:'A real Paystack payment is initialized, verified and reflected once without duplicate charging.',source:'manual',critical:true,maxAgeDays:7},
  {key:'eats.real_vendor_order',category:'Eats',title:'Real vendor/private-kitchen order',description:'Customer selects delivery location, places a real vendor order and the vendor accepts/prepares it.',source:'manual',critical:true,maxAgeDays:14},
  {key:'eats.courier_assignment',category:'Eats',title:'Eats courier assignment',description:'An eligible courier is assigned without duplicate work and sees the correct delivery job.',source:'manual',critical:true,maxAgeDays:14},
  {key:'eats.live_tracking',category:'Eats',title:'Eats live tracking',description:'Customer receives live courier progress through pickup, arrival and delivery.',source:'manual',critical:true,maxAgeDays:14},
  {key:'eats.real_payment',category:'Eats',title:'Real Eats payment',description:'A real low-value food checkout is verified and linked to the correct order(s).',source:'manual',critical:true,maxAgeDays:7},
  {key:'courier.real_booking',category:'Courier',title:'Real parcel booking',description:'Sender creates a parcel job and an eligible courier/driver claims it through the courier flow.',source:'manual',critical:true,maxAgeDays:14},
  {key:'courier.recipient_tracking',category:'Courier',title:'Recipient tracking',description:'Recipient tracking works without exposing unauthorized account or route data.',source:'manual',critical:true,maxAgeDays:14},
  {key:'courier.proof_delivery',category:'Courier',title:'Proof of delivery',description:'Pickup/handover and delivery proof are recorded against the correct parcel transaction.',source:'manual',critical:true,maxAgeDays:14},
  {key:'safety.panic_real_device',category:'Safety',title:'Real-device panic flow',description:'A real device creates the panic event and it appears in the Safety Alerts workflow.',source:'manual',critical:true,maxAgeDays:7},
  {key:'safety.family_notification',category:'Safety',title:'Family/guardian notification',description:'An authorized family/guardian receives the intended live journey safety update.',source:'manual',critical:true,maxAgeDays:14},
  {key:'safety.provider_acceptance',category:'Safety',title:'External safety provider acceptance',description:'Configured external notification/emergency provider delivery is verified end-to-end.',source:'manual',critical:true,maxAgeDays:14},
  {key:'mobile.android_acceptance',category:'Mobile',title:'Android production acceptance',description:'Android sign-in, location, matching, background notification and active-trip flow pass on a real device.',source:'manual',critical:true,maxAgeDays:30},
  {key:'mobile.ios_acceptance',category:'Mobile',title:'iPhone production acceptance',description:'iOS sign-in, location, matching, background notification and active-trip flow pass on a real device.',source:'manual',critical:true,maxAgeDays:30},
].map(item=>Object.freeze(item)));
const byKey=new Map(ACCEPTANCE_CATALOG.map(item=>[item.key,item]));
export const acceptanceCheck=key=>byKey.get(key)??null;
export function manualAcceptanceCheck(key){const item=acceptanceCheck(key);check(item?.source==='manual','INVALID_INPUT','Choose a manual production acceptance test.');return item;}
export function acceptanceResultInput(data){
 fields(data,['status','evidenceRef','note','expectedVersion']);
 check(['passed','failed','needs_retest'].includes(data.status),'INVALID_INPUT','Choose Passed, Failed or Needs retest.');
 check(Number.isSafeInteger(data.expectedVersion)&&data.expectedVersion>=0,'INVALID_VERSION','Refresh this acceptance check before updating it.');
 return {status:data.status,evidenceRef:label(data.evidenceRef,'Evidence reference',2,200),note:label(data.note,'Test note',5,1000),expectedVersion:data.expectedVersion};
}
export function effectiveManualResult(checkItem,row,now){
 if(!row)return {status:'not_tested',storedStatus:null,version:0,evidenceRef:'',note:'',tester:null,testedAt:null,stale:false};
 const stale=row.status==='passed'&&Number.isFinite(checkItem.maxAgeDays)&&now-row.testedAt>checkItem.maxAgeDays*DAY;
 return {status:stale?'needs_retest':row.status,storedStatus:row.status,version:Number(row.version),evidenceRef:row.evidenceRef,note:row.note,
  tester:row.testerId?{id:row.testerId,name:row.testerName??'Staff member'}:null,testedAt:Number(row.testedAt),stale};
}
export function canonicalAcceptance(value){return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))));}
