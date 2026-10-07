import {check} from '../../shared/errors.mjs';
export function adminMatchingRoutes(service){return [{method:'GET',path:/^\/api\/admin\/console\/matching$/,access:'read',async handle({user,query}){
 const entries=[...query.entries()];check(new Set(entries.map(([key])=>key)).size===entries.length,'INVALID_INPUT','Do not repeat a filter.');
 return {body:await service.get(user,Object.fromEntries(entries))};
}}];}
