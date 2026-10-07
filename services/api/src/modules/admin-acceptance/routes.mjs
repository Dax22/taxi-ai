import { check } from '../../shared/errors.mjs';
export function adminAcceptanceRoutes(service){return [
 {method:'GET',path:/^\/api\/admin\/console\/acceptance$/,access:'read',handle:async({user,query})=>{check([...query].length===0,'INVALID_INPUT','This page does not accept filters.');return {body:await service.get(user)};}},
 {method:'POST',path:/^\/api\/admin\/console\/acceptance\/([a-z0-9_.-]{3,80})\/result$/,access:'write',handle:async({user,match,data,key})=>({body:await service.record({userId:user.id,checkKey:match[1],data,key})})},
];}
