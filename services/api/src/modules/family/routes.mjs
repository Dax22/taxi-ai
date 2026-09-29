import { check } from '../../shared/errors.mjs';

async function reply(context,run) {
  check(!context.query || [...context.query.keys()].length===0,'INVALID_FIELDS','Family Safety does not accept query parameters.');
  const body=await run(),fresh=await context.reauthenticate();
  check(fresh?.id===context.user.id,'UNAUTHENTICATED','Sign in to continue.');
  return {body};
}
export function familyRoutes(family) {
  return [
    {method:'GET',path:/^\/api\/family$/,access:'read',handle:async(context)=>await reply(context,()=>family.get(context.user.id))},
    {method:'GET',path:/^\/api\/family\/trips\/([a-f0-9-]{36})$/,access:'read',handle:async(context)=>await reply(context,()=>family.trip(context.user.id,context.match[1]))},
    {method:'POST',path:/^\/api\/family\/(invite|accept|decline|revoke-contact|share|stop-sharing|request-check-in|respond|acknowledge)$/,access:'write',
      handle:async(context)=>await reply(context,()=>family.command({userId:context.user.id,action:context.match[1],data:context.data,key:context.key}))},
  ];
}
