import { check } from '../../shared/errors.mjs';
function queryFields(query){const entries=[...query.entries()];check(new Set(entries.map(([key])=>key)).size===entries.length,'INVALID_INPUT','Do not repeat a filter.');return Object.fromEntries(entries);}
export function adminMobileRoutes(service){const prefix='/api/admin/console/mobile';return[
 {method:'GET',path:new RegExp(`^${prefix}$`),access:'read',handle:async({user,query})=>({body:await service.get(user.id,queryFields(query))})},
 {method:'POST',path:new RegExp(`^${prefix}/devices/([a-f0-9-]{36})/revoke$`),access:'write',handle:async({user,match,data,key})=>{check(data&&Object.keys(data).length===0,'INVALID_FIELDS','This action does not accept fields.');return{body:await service.revoke({userId:user.id,sessionId:match[1],key})};}},
];}
