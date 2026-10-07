import { check } from '../../shared/errors.mjs';

export function adminInsightRoutes(service){
 const q=query=>{const entries=[...query];check(new Set(entries.map(([k])=>k)).size===entries.length,'INVALID_INPUT','Do not repeat filters.');return Object.fromEntries(entries);};
 return [
  ...[['insights','summary'],['brief','brief'],['platform','platform'],['reports','reports'],['campaigns','campaigns'],['access-audit','accessAudit']].map(([path,name])=>({method:'GET',path:new RegExp(`^/api/admin/console/${path}$`),access:'read',handle:async ctx=>{
   const query=q(ctx.query);if(['brief','platform','reports','campaigns'].includes(path))check(Object.keys(query).length===0,'INVALID_INPUT','This page has no filters.');return {body:await service[name](ctx.user,query)};
  }})),
  {method:'POST',path:/^\/api\/admin\/console\/reports$/,access:'write',handle:async ctx=>({body:await service.saveReport(ctx.user,ctx.data,ctx.key)})},
  {method:'POST',path:/^\/api\/admin\/console\/reports\/([a-f0-9-]{36})\/remove$/,access:'write',handle:async ctx=>({body:await service.removeReport(ctx.user,ctx.match[1],ctx.data,ctx.key)})},
  {method:'POST',path:/^\/api\/admin\/console\/campaigns$/,access:'write',handle:async ctx=>({body:await service.saveCampaign(ctx.user,ctx.data,ctx.key)})},
  {method:'POST',path:/^\/api\/admin\/console\/campaigns\/([a-f0-9-]{36})\/archive$/,access:'write',handle:async ctx=>({body:await service.archiveCampaign(ctx.user,ctx.match[1],ctx.data,ctx.key)})},
 ];
}
