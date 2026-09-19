export function locationRoutes(locations) {
  const identity = ({ user, token, locationClient }) => ({ userId: user.id, sessionToken: token, clientId: locationClient });
  return [
    { method: 'GET', path: /^\/api\/locations$/, access: 'read', handle: (ctx) => ({ body: { settings: locations.settings(identity(ctx)) } }) },
    { method: 'POST', path: /^\/api\/locations\/search$/, access: 'write', handle: async (ctx) => ({ body: await locations.search(identity(ctx), ctx.data) }) },
    { method: 'POST', path: /^\/api\/locations\/quotes$/, access: 'write', handle: async (ctx) => {
      const body = await locations.quote(identity(ctx), ctx.data, ctx.key); return { status: body.replayed ? 200 : 201, body };
    } },
    { method: 'GET', path: /^\/api\/rides\/([a-f0-9-]{36})\/location$/, access: 'read',
      handle: (ctx) => ({ body: locations.tracking(identity(ctx), ctx.match[1]) }) },
    { method: 'POST', path: /^\/api\/rides\/([a-f0-9-]{36})\/location\/start$/, access: 'write',
      handle: (ctx) => ({ body: locations.shareCommand(identity(ctx), 'start', ctx.match[1], ctx.data, ctx.key) }) },
    { method: 'POST', path: /^\/api\/location-shares\/([a-f0-9-]{36})\/stop$/, access: 'write',
      handle: (ctx) => ({ body: locations.shareCommand(identity(ctx), 'stop', ctx.match[1], ctx.data, ctx.key) }) },
    { method: 'POST', path: /^\/api\/location-shares\/([a-f0-9-]{36})\/position$/, access: 'write',
      handle: (ctx) => ({ body: locations.update(identity(ctx), ctx.match[1], ctx.data) }) },
  ];
}
