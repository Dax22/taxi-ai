export function locationRoutes(locations) {
  const identity = ({ user, token, locationClient }) => ({ userId: user.id, sessionToken: token, clientId: locationClient });
  return [
    { method: 'GET', path: /^\/api\/locations$/, access: 'read', handle: async (ctx) => ({ body: { settings: (await locations.settings(identity(ctx))) } }) },
    { method: 'POST', path: /^\/api\/locations\/search$/, access: 'write', handle: async (ctx) => ({ body: await locations.search(identity(ctx), ctx.data) }) },
    { method: 'POST', path: /^\/api\/locations\/reverse$/, access: 'write', handle: async (ctx) => ({ body: await locations.reverse(identity(ctx), ctx.data) }) },
    { method: 'POST', path: /^\/api\/locations\/quotes$/, access: 'write', handle: async (ctx) => {
      const body = await locations.quote(identity(ctx), ctx.data, ctx.key); return { status: body.replayed ? 200 : 201, body };
    } },
    { method: 'GET', path: /^\/api\/rides\/([a-f0-9-]{36})\/location$/, access: 'read',
      handle: async (ctx) => ({ body: (await locations.tracking(identity(ctx), ctx.match[1])) }) },
    { method: 'POST', path: /^\/api\/rides\/([a-f0-9-]{36})\/location\/start$/, access: 'write',
      handle: async (ctx) => ({ body: (await locations.shareCommand(identity(ctx), 'start', ctx.match[1], ctx.data, ctx.key)) }) },
    { method: 'POST', path: /^\/api\/location-shares\/([a-f0-9-]{36})\/stop$/, access: 'write',
      handle: async (ctx) => ({ body: (await locations.shareCommand(identity(ctx), 'stop', ctx.match[1], ctx.data, ctx.key)) }) },
    { method: 'POST', path: /^\/api\/location-shares\/([a-f0-9-]{36})\/position$/, access: 'write',
      handle: async (ctx) => ({ body: (await locations.update(identity(ctx), ctx.match[1], ctx.data)) }) },
  ];
}
