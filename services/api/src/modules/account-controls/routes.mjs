import { check } from '../../shared/errors.mjs';

const queryFields=query=>{const entries=[...query];check(new Set(entries.map(([k])=>k)).size===entries.length,'INVALID_INPUT','Do not repeat filters.');return Object.fromEntries(entries);};
const noQuery=ctx=>check([...ctx.query].length===0,'INVALID_INPUT','This action does not accept query parameters.');
async function checked(ctx,body){const fresh=await ctx.reauthenticate();check(fresh?.id===ctx.user.id,'UNAUTHENTICATED','Sign in again.');return {body};}
export function adminAccountControlRoutes(service){return [
 {method:'GET',path:/^\/api\/admin\/console\/restrictions$/,access:'read',handle:async ctx=>checked(ctx,await service.list(ctx.user,queryFields(ctx.query)))},
 {method:'GET',path:/^\/api\/admin\/console\/restriction-impact$/,access:'read',handle:async ctx=>{const q=queryFields(ctx.query);check(Object.keys(q).length===2&&q.subjectType&&q.subjectId,'INVALID_INPUT','Select the affected account or store.');return checked(ctx,await service.impact(ctx.user,q.subjectType,q.subjectId));}},
 {method:'POST',path:/^\/api\/admin\/console\/restrictions$/,access:'write',handle:async ctx=>{noQuery(ctx);return checked(ctx,await service.apply(ctx.user,ctx.data,ctx.key));}},
 {method:'GET',path:/^\/api\/admin\/console\/restrictions\/([a-f0-9-]{36})$/,access:'read',handle:async ctx=>{noQuery(ctx);return checked(ctx,await service.detail(ctx.user,ctx.match[1]));}},
 ...[['lift','lift'],['appeal-decision','decideAppeal']].map(([path,method])=>({method:'POST',path:new RegExp(`^/api/admin/console/restrictions/([a-f0-9-]{36})/${path}$`),access:'write',handle:async ctx=>{noQuery(ctx);return checked(ctx,await service[method](ctx.user,ctx.match[1],ctx.data,ctx.key));}})),
];}
export function accountNoticeRoutes(service){return [
 {method:'GET',path:/^\/api\/account\/notices$/,access:'read',handle:async ctx=>checked(ctx,await service.mine(ctx.user,queryFields(ctx.query)))},
 {method:'GET',path:/^\/api\/account\/notices\/([a-f0-9-]{36})$/,access:'read',handle:async ctx=>{noQuery(ctx);return checked(ctx,await service.ownDetail(ctx.user,ctx.match[1]));}},
 {method:'POST',path:/^\/api\/account\/notices\/([a-f0-9-]{36})\/appeal$/,access:'write',handle:async ctx=>{noQuery(ctx);return checked(ctx,await service.appeal(ctx.user,ctx.match[1],ctx.data,ctx.key));}},
];}
