import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const KINDS = Object.freeze(['ride','courier','food']);
export const BASES = Object.freeze(['court_order','warrant','documented_police_request','urgent_safety','internal_investigation']);
export function ref(kind,id) {
  check(KINDS.includes(kind) && typeof id === 'string' && uuid.test(id), 'INVALID_INPUT', 'Choose a valid ride, courier or food transaction.');
  return { kind, id };
}
export function exportRequest(data) {
  fields(data,['service','transactionId','caseReference','requestingAuthority','legalBasis','authorityReference','purpose','includeDocuments','includeMessages','acknowledged']);
  const {kind,id} = ref(data.service,data.transactionId);
  const caseReference=label(data.caseReference,'Case reference',5,100),requestingAuthority=label(data.requestingAuthority,'Requesting agency or internal team',4,160),
    authorityReference=label(data.authorityReference,'Document / authority reference',4,160),purpose=label(data.purpose,'Reason and scope',20,800);
  check(BASES.includes(data.legalBasis),'INVALID_INPUT','Choose a documented legal basis.');
  check(['yes','no'].includes(data.includeDocuments) && ['yes','no'].includes(data.includeMessages),'INVALID_INPUT','Choose whether sensitive evidence is included.');
  check(data.acknowledged==='yes','INVALID_INPUT','Confirm you have verified authorization and will transfer evidence securely.');
  check(![caseReference,requestingAuthority,authorityReference,purpose].some(v=>/[\u0000-\u001f\u007f]/u.test(v)),'INVALID_INPUT','Evidence references cannot contain control characters.');
  return {kind,id,caseReference,requestingAuthority,authorityReference,purpose,legalBasis:data.legalBasis,
    includeDocuments:data.includeDocuments==='yes',includeMessages:data.includeMessages==='yes'};
}
export const parse = value => {if(!value)return null;try{return JSON.parse(value);}catch{return null;}};
export const pick = (obj,fields) => obj && typeof obj==='object' && !Array.isArray(obj)
  ? Object.fromEntries(fields.filter(key=>obj[key]!==undefined).map(key=>[key,obj[key]])) : {};
export const iso = value => value==null?null:new Date(Number(value)).toISOString();
export const wat = value => value==null?null:new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'short'}).format(new Date(Number(value)));
const cell=value=>{let text=String(value??'');if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
export function csv(headers,rows) {return [headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';}
export const asMoney = value => value==null?null:{amountKobo:String(value),currency:'NGN',formattedNgn:`${BigInt(value)/100n}.${String(BigInt(value)%100n).padStart(2,'0')}`};
export function timelineRow(type,action,createdAt,actorId,note='') {
  return {category:type,action,recordedAtUtc:iso(createdAt),recordedAtWat:wat(createdAt),actorId:actorId??null,note:String(note??'').slice(0,2000)};
}
