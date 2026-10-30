import { check } from '../../shared/errors.mjs';

export function rideIntegrityRoutes(service) {
  return [
    {method:'GET',path:/^\/api\/admin\/console\/ride-integrity$/,access:'read',
      handle:async ({user,query})=>{
        const entries=[...query.entries()];
        check(entries.length<=2&&new Set(entries.map(([key])=>key)).size===entries.length,'INVALID_INPUT','Do not repeat filters.');
        return {body:await service.list(user.id,Object.fromEntries(entries))};
      }},
    {method:'GET',path:/^\/api\/admin\/console\/ride-integrity\/([a-f0-9-]{36})$/,access:'read',
      handle:async ({user,match})=>({body:await service.get(user.id,match[1])})},
    {method:'POST',path:/^\/api\/admin\/console\/ride-integrity\/([a-f0-9-]{36})\/review$/,access:'write',
      handle:async ({user,match,data,key})=>({body:await service.review({userId:user.id,id:match[1],data,key})})},
  ];
}
