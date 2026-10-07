import { check } from '../../shared/errors.mjs';

const queryFields = query => { const entries=[...query.entries()];check(new Set(entries.map(([name])=>name)).size===entries.length,'INVALID_INPUT','Do not repeat filters.');return Object.fromEntries(entries); };
export function adminTransactionRoutes(service) {
  const base='/api/admin/console';
  return [
    ...[['transactions','list'],['transactions-export','export'],['people','people'],['businesses','stores']].map(([path,method])=>({
      method:'GET',path:new RegExp(`^${base}/${path}$`),access:'read',
      handle:async({user,query})=>({body:await service[method](user,queryFields(query))}) })),
    ...[['people','person'],['businesses','store']].map(([path,method])=>({
      method:'GET',path:new RegExp(`^${base}/${path}/([a-f0-9-]{36})$`),access:'read',
      handle:async({user,match,query})=>({body:await service[method](user,match[1],queryFields(query))}) })),
    {method:'GET',path:/^\/api\/admin\/console\/transactions\/(ride|courier|food)\/([a-f0-9-]{36})$/,access:'read',
      handle:async({user,match,query})=>{check([...query].length===0,'INVALID_INPUT','Details do not accept filters.');return {body:await service.detail(user,match[1],match[2])};}},
    {method:'GET',path:/^\/api\/admin\/console\/live\/(ride|courier|food)\/([a-f0-9-]{36})$/,access:'read',
      handle:async({user,match,query})=>{const input=queryFields(query);check(Object.keys(input).length===1&&input.purpose,'INVALID_INPUT','Choose an access purpose.');return {body:await service.location(user,match[1],match[2],input.purpose)};}},
    {method:'GET',path:/^\/api\/admin\/console\/diagnosis\/(ride|courier|food)\/([a-f0-9-]{36})$/,access:'read',
      handle:async({user,match,query})=>{check([...query].length===0,'INVALID_INPUT','Diagnostics do not accept filters.');return {body:await service.diagnosis(user,match[1],match[2])};}},
  ];
}
