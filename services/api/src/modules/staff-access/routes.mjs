import { check } from '../../shared/errors.mjs';

function queryFields(query) {
  const entries=[...query.entries()];check(new Set(entries.map(([key])=>key)).size===entries.length,'INVALID_INPUT','Do not repeat a staff filter.');
  return Object.fromEntries(entries);
}
async function reply(context,run) {
  const body=await run(),fresh=await context.reauthenticate();check(fresh?.id===context.user.id,'UNAUTHENTICATED','Sign in to continue.');return {body};
}
export function staffAccessRoutes(staff) {
  return [
    {method:'GET',path:/^\/api\/admin\/console\/staff$/,access:'read',staffPermission:'staff.manage',
      handle:async(context)=>{check([...context.query.keys()].length===0,'INVALID_INPUT','The staff list does not accept filters.');return await reply(context,()=>staff.list(context.user.id));}},
    {method:'GET',path:/^\/api\/admin\/console\/staff\/audit$/,access:'read',staffPermission:'audit.read',
      handle:async(context)=>await reply(context,()=>staff.auditLog(context.user.id,queryFields(context.query)))},
    {method:'POST',path:/^\/api\/admin\/console\/staff\/(assign|revoke|revoke-sessions)$/,access:'write',staffPermission:'staff.manage',
      handle:async(context)=>{check([...context.query.keys()].length===0,'INVALID_INPUT','Staff actions do not accept filters.');return await reply(context,
        ()=>staff.command({userId:context.user.id,action:context.match[1],data:context.data,key:context.key}));}},
    {method:'POST',path:/^\/api\/admin\/console\/staff\/mfa\/(enroll|confirm|verify)$/,access:'write',staffBootstrap:true,
      handle:async(context)=>{check([...context.query.keys()].length===0,'INVALID_INPUT','Authenticator actions do not accept filters.');return await reply(context,
        ()=>staff[context.match[1]]({userId:context.user.id,sessionToken:context.token,data:context.data}));}},
  ];
}
