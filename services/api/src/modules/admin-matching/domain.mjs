import {check} from '../../shared/errors.mjs';
import {fields} from '../../shared/validation.mjs';
export function matchingFilters(query={},now){
 fields(query,['window'],[]);const window=query.window??'7d';
 const durations={ '24h':24*60*60_000,'7d':7*24*60*60_000,'30d':30*24*60*60_000 };
 check(Object.hasOwn(durations,window),'INVALID_INPUT','Choose a matching window of 24h, 7d or 30d.');
 return {window,since:Math.max(0,now-durations[window])};
}
export function distribution(values){
 const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b),pick=p=>sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]:null;
 return {count:sorted.length,p50:pick(.5),p95:pick(.95),p99:pick(.99),max:sorted.at(-1)??null};
}
export const ratio=(n,d)=>d?Number(n)/Number(d):null;
