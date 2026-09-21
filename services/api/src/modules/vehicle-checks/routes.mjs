export function vehicleCheckRoutes(checks) {
  const identity = ctx => ({ userId:ctx.user.id,sessionToken:ctx.token });
  const path = /^\/api\/vehicle-checks\/rides\/([a-f0-9-]{36})$/;
  return [
    { method:'GET',path,access:'read',handle:ctx => ({ body:checks.list(identity(ctx),ctx.match[1]) }) },
    { method:'POST',path,access:'write',maxBodyBytes:2_800_000,
      handle:async ctx => ({ body:await checks.analyse(identity(ctx),ctx.match[1],ctx.data,ctx.key) }) },
  ];
}
