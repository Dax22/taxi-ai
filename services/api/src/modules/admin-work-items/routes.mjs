import { check } from '../../shared/errors.mjs';

export function adminWorkRoutes(service) {
 const queryFields=query=>{const entries=[...query];check(new Set(entries.map(([k])=>k)).size===entries.length,'INVALID_INPUT','Do not repeat filters.');return Object.fromEntries(entries);};
 const checked=async(ctx,body)=>{const fresh=await ctx.reauthenticate();check(fresh.id===ctx.user.id,'UNAUTHENTICATED','Sign in again.');await service.verifyAccess(fresh,body.item?.category||body.category);return {body};};
 return [
  {method:'GET',path:/^\/api\/admin\/console\/work$/,access:'read',handle:async ctx=>checked(ctx,await service.list(ctx.user,queryFields(ctx.query)))},
  {method:'POST',path:/^\/api\/admin\/console\/work$/,access:'write',handle:async ctx=>checked(ctx,await service.create(ctx.user,ctx.data,ctx.key))},
  {method:'GET',path:/^\/api\/admin\/console\/work\/([a-f0-9-]{36})$/,access:'read',handle:async ctx=>{check([...ctx.query].length===0,'INVALID_INPUT','Details do not accept filters.');return checked(ctx,await service.detail(ctx.user,ctx.match[1]));}},
  {method:'POST',path:/^\/api\/admin\/console\/work\/([a-f0-9-]{36})$/,access:'write',handle:async ctx=>checked(ctx,await service.update(ctx.user,ctx.match[1],ctx.data,ctx.key))},
 ];
}
