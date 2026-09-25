export function availabilityRoutes(availability) {
  const identity = ({ user, token, availabilityClient }) => ({ userId: user.id, sessionToken: token, clientId: availabilityClient });
  return [
    { method: 'GET', path: /^\/api\/availability$/, access: 'read', handle: async (ctx) => ({ body: (await availability.get(identity(ctx))) }) },
    { method: 'POST', path: /^\/api\/availability\/online$/, access: 'write',
      handle: async (ctx) => ({ body: (await availability.command(identity(ctx), 'online', null, ctx.data, ctx.key)) }) },
    { method: 'POST', path: /^\/api\/availability\/([a-f0-9-]{36})\/offline$/, access: 'write',
      handle: async (ctx) => ({ body: (await availability.command(identity(ctx), 'offline', ctx.match[1], ctx.data, ctx.key)) }) },
    { method: 'POST', path: /^\/api\/availability\/([a-f0-9-]{36})\/position$/, access: 'write',
      handle: async (ctx) => ({ body: (await availability.update(identity(ctx), ctx.match[1], ctx.data)) }) },
  ];
}
