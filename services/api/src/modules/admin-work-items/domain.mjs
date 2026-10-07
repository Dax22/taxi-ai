import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';

export const CATEGORY = {support:'support',safety:'safety',refund_review:'finance',return_review:'operations',redelivery_review:'operations',damaged_item:'support',missing_item:'support',assignment_review:'operations',compliance:'operations'};
export const PERMISSION = {operations:'operations.read',support:'cases.support',safety:'cases.safety',finance:'finance.read'};
export const TERMINAL = ['resolved','rejected'];
export const key = value => {check(typeof value==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(value),'INVALID_IDEMPOTENCY_KEY','Use a unique action key.');return value;};
export const id = value => {check(typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value),'INVALID_INPUT','Choose a valid record.');return value;};
export function version(value) {const n=typeof value==='string'&&/^\d+$/.test(value)?Number(value):value;check(Number.isSafeInteger(n)&&n>=1,'INVALID_VERSION','Refresh the current record.');return n;}
export function createInput(data,now) {
 fields(data,['entityType','entityId','kind','title','description','priority']);id(data.entityId);
 check(['ride','courier','food','account','store'].includes(data.entityType)&&Object.hasOwn(CATEGORY,data.kind),'INVALID_INPUT','Choose a valid linked entity and work type.');
 check(['normal','high','urgent'].includes(data.priority),'INVALID_INPUT','Choose a priority.');
 return {...data,category:CATEGORY[data.kind],title:label(data.title,'Title',5,120),description:label(data.description,'Description',10,2000),dueAt:now+({normal:86400000,high:14400000,urgent:1800000})[data.priority]};
}
export function filters(input={}) {
 fields(input,['category','status','entityType','entityId','before','limit'],[]);
 const category=input.category||'operations',status=input.status||'active',limit=Number(input.limit||25);
 check(Object.hasOwn(PERMISSION,category)&&['all','active','open','in_progress','waiting','resolved','rejected'].includes(status),'INVALID_INPUT','Invalid queue.');
 check(Number.isInteger(limit)&&limit>0&&limit<=100,'INVALID_INPUT','Choose 1-100 rows.');
 if(input.entityId)id(input.entityId);if(input.before)id(input.before);
 check(!input.entityType||['ride','courier','food','account','store'].includes(input.entityType),'INVALID_INPUT','Invalid entity type.');
 return {category,status,limit,entityType:input.entityType||null,entityId:input.entityId||null,before:input.before||null};
}
export function updateInput(data) {
 fields(data,['expectedVersion','action','note','assigneeId','status'],['expectedVersion','action','note']);
 const expectedVersion=version(data.expectedVersion),note=label(data.note,'Action note',5,2000);
 check(['note','assign','status'].includes(data.action),'INVALID_INPUT','Choose an action.');
 if(data.action==='assign'){check(data.status===undefined,'INVALID_FIELDS','Status is not an assignment field.');if(data.assigneeId)id(data.assigneeId);}
 if(data.action==='status'){check(['open','in_progress','waiting','resolved','rejected'].includes(data.status)&&data.assigneeId===undefined,'INVALID_INPUT','Choose a status.');}
 if(data.action==='note')check(data.status===undefined&&data.assigneeId===undefined,'INVALID_FIELDS','Notes cannot alter assignment or status.');
 return {...data,expectedVersion,note,assigneeId:data.action==='assign'?data.assigneeId||null:undefined};
}
