import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';

export function summaryInput(input={}) { fields(input,['from','to','service'],[]);return input; }
export function reportInput(data) {fields(data,['title','service','status','from','to']);return {title:label(data.title,'Report title',3,120),filters:{service:data.service,status:data.status,from:data.from,to:data.to}};}
export function commandKey(key){check(typeof key==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(key),'INVALID_IDEMPOTENCY_KEY','Use a unique command key.');}
export function campaignInput(data){fields(data,['title','service','budgetKobo','discountKobo','note']);const budgetKobo=Number(data.budgetKobo),discountKobo=Number(data.discountKobo);check(['ride','courier','food'].includes(data.service)&&Number.isSafeInteger(budgetKobo)&&budgetKobo>0&&Number.isSafeInteger(discountKobo)&&discountKobo>0&&discountKobo<=budgetKobo,'INVALID_INPUT','Choose a service and valid whole-kobo budget and discount.');return {title:label(data.title,'Campaign title',3,120),service:data.service,budgetKobo,discountKobo,note:label(data.note,'Planning note',10,1000)};}
export const id=value=>{check(typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value),'INVALID_INPUT','Select a valid record.');return value;};
