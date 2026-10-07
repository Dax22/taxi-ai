export type CallStatus='ringing'|'connecting'|'connected'|'ended'|'declined'|'missed'|'failed';
export interface CallPeer{id:string;name:string}
export interface CallRecord{id:string;rideId:string;status:CallStatus;version:number;caller:CallPeer;callee:CallPeer;createdAt:number;answeredAt:number|null;connectedAt:number|null;endedAt:number|null;endedBy:string|null;reason:string|null;ringExpiresAt:number;owned:boolean}
export interface CallSettings{mode:'off'|'local'|'relay';enabled:boolean;ringSeconds:number;maximumMinutes:number}
export interface CallsView{settings:CallSettings;active:CallRecord|null;recent:CallRecord[]}
export interface CallMedia{call:CallRecord;configuration:{iceServers:any[];iceTransportPolicy?:string};remoteDescription:{type:'offer'|'answer';sdp:string}|null}
const id=(v:any)=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v),num=(v:any)=>Number.isSafeInteger(v)&&v>=0;
function peer(v:any){if(!v||!id(v.id)||typeof v.name!=='string')throw new Error('Taxi Ai returned an invalid call participant.');return v as CallPeer;}
export function call(v:any):CallRecord{
 if(!v||!id(v.id)||!id(v.rideId)||!['ringing','connecting','connected','ended','declined','missed','failed'].includes(v.status)||!Number.isSafeInteger(v.version)||v.version<1
   ||!num(v.createdAt)||!num(v.ringExpiresAt)||typeof v.owned!=='boolean')throw new Error('Taxi Ai returned an invalid call state.');
 peer(v.caller);peer(v.callee);for(const key of ['answeredAt','connectedAt','endedAt'])if(v[key]!==null&&!num(v[key]))throw new Error('Taxi Ai returned invalid call timing.');
 if(v.endedBy!==null&&typeof v.endedBy!=='string'||v.reason!==null&&typeof v.reason!=='string')throw new Error('Taxi Ai returned invalid call details.');return v as CallRecord;
}
export function callsView(v:any):CallsView{
 if(!v||!v.settings||!['off','local','relay'].includes(v.settings.mode)||typeof v.settings.enabled!=='boolean'||!num(v.settings.ringSeconds)||!num(v.settings.maximumMinutes)
   ||!Array.isArray(v.recent))throw new Error('Taxi Ai returned invalid call settings.');
 if(v.active!==null)call(v.active);v.recent.forEach(call);return v as CallsView;
}
export function callResult(v:any):{call:CallRecord;replayed:boolean}{if(!v||typeof v.replayed!=='boolean')throw new Error('Taxi Ai returned an invalid call result.');call(v.call);return v;}
export function callMedia(v:any):CallMedia{
 if(!v||!v.configuration||!Array.isArray(v.configuration.iceServers)||!['all','relay',undefined].includes(v.configuration.iceTransportPolicy))throw new Error('Taxi Ai returned invalid call network settings.');call(v.call);
 if(v.remoteDescription!==null&&(!['offer','answer'].includes(v.remoteDescription?.type)||typeof v.remoteDescription?.sdp!=='string'||v.remoteDescription.sdp.length<10))throw new Error('Taxi Ai returned invalid call audio details.');return v as CallMedia;
}
