export function callRoutes(calls) {
  const identity = ({ user, token, callClient }) => ({ userId: user.id, sessionToken: token, clientId: callClient });
  const write = async (context, action, id = null, rideId = null) => {
    const result = (await calls.mutate({ ...identity(context), action, id, rideId, key: context.key, data: context.data }));
    return { status: action === 'create' && !result.replayed ? 201 : 200, body: result };
  };
  return [
    { method: 'GET', path: /^\/api\/calls$/, access: 'read', handle: async (ctx) => ({ body: (await calls.list(identity(ctx))) }) },
    { method: 'POST', path: /^\/api\/rides\/([a-f0-9-]{36})\/calls$/, access: 'write', handle: async (ctx) => (await write(ctx, 'create', null, ctx.match[1])) },
    { method: 'GET', path: /^\/api\/calls\/([a-f0-9-]{36})\/media$/, access: 'read', handle: async (ctx) => ({ body: (await calls.media(identity(ctx), ctx.match[1])) }) },
    { method: 'POST', path: /^\/api\/calls\/([a-f0-9-]{36})\/(accept|decline|end|signal)$/, access: 'write',
      handle: async (ctx) => (await write(ctx, ctx.match[2], ctx.match[1])) },
    { method: 'POST', path: /^\/api\/calls\/([a-f0-9-]{36})\/pulse$/, access: 'write',
      handle: async (ctx) => ({ body: (await calls.pulse(identity(ctx), ctx.match[1], ctx.data)) }) },
  ];
}
