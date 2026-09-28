import { envelope } from '../../../../packages/shared/src/mobile-contracts.mjs';
export interface Contact {id:string;name:string;phone:string;version:number;verified:false}
export interface ShareLink {id:string;active:boolean;version:number;expiresAt:number}
export interface Incident {id:string;kind:string;status:string;note:string;createdAt:number;updatedAt:number;notifications:Array<{id:string;recipientName:string;status:string;mode:'simulation'}>}
export interface SafetyTrip {rideId:string;canRaise:boolean;share:ShareLink|null;location:{capturedAt:number;stale:boolean;lat:number;lng:number}|null;incidents:Incident[];serverNow:number}
export interface SafetyResult {replayed:boolean;token?:string|null;share?:ShareLink|null;contact?:Contact|null;incident?:Incident;serverNow:number}
const obj=(v:any)=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const id=(v:any)=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v);
const text=(v:any,n=500)=>typeof v==='string'&&v.length<=n;
const num=(v:any)=>Number.isSafeInteger(v)&&v>=0;
function check(v:any):asserts v {if(!v)throw new Error('Taxi Ai returned an incompatible safety response. Refresh and try again.');}
function contact(v:any){check(obj(v)&&id(v.id)&&text(v.name,100)&&/^\+[1-9][0-9]{7,14}$/.test(v.phone)&&num(v.version)&&v.verified===false);}
function share(v:any){check(v===null||obj(v)&&id(v.id)&&typeof v.active==='boolean'&&num(v.version)&&num(v.expiresAt));}
function incident(v:any){check(obj(v)&&id(v.id)&&['need_help','possible_crash','unsafe_behaviour','other'].includes(v.kind)&&['open','acknowledged','resolved'].includes(v.status)&&text(v.note)&&num(v.createdAt)&&num(v.updatedAt)&&Array.isArray(v.notifications)&&v.notifications.length<=3);for(const n of v.notifications)check(obj(n)&&id(n.id)&&text(n.recipientName,100)&&n.mode==='simulation'&&['queued','sent','delivered','failed','cancelled'].includes(n.status));}
export function readContacts(v:any):Contact[]{envelope(v);check(Array.isArray(v.contacts)&&v.contacts.length<=3);v.contacts.forEach(contact);return v.contacts;}
export function readSafety(v:any):SafetyTrip{envelope(v);check(id(v.rideId)&&typeof v.canRaise==='boolean'&&Array.isArray(v.incidents)&&v.incidents.length<=20);share(v.share);v.incidents.forEach(incident);check(v.location===null||obj(v.location)&&num(v.location.capturedAt)&&typeof v.location.stale==='boolean'&&Number.isFinite(v.location.lat)&&Math.abs(v.location.lat)<=90&&Number.isFinite(v.location.lng)&&Math.abs(v.location.lng)<=180);return v;}
export function readSafetyResult(v:any,path?:string):SafetyResult{envelope(v);check(typeof v.replayed==='boolean');if('contact'in v&&v.contact!==null)contact(v.contact);if('share'in v)share(v.share);if('incident'in v)incident(v.incident);if('token'in v)check(v.token===null||typeof v.token==='string'&&/^[a-f0-9]{64}$/.test(v.token));
if(path){
 if(path.endsWith('/incidents'))check(obj(v.incident));
 else if(path==='contacts'||path.endsWith('/edit'))check(obj(v.contact)||(v.replayed&&v.contact===null));
 else if(path.endsWith('/remove'))check(v.contact===null);
 else if(path.endsWith('/links'))check(obj(v.share)&&('token'in v)&&(v.replayed||typeof v.token==='string'));
 else if(path.endsWith('/revoke'))check(obj(v.share)&&v.share.active===false);
 else check(false);
}return v;}
