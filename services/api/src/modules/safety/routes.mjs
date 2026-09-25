export function safetyRoutes(safety) {
  const write = async (action, id, ctx) => ({ body: (await safety.command({ userId: ctx.user.id, sessionToken: ctx.token, action, id, data: ctx.data, key: ctx.key })) });
  return [
    { method: 'GET', path: /^\/api\/safety\/contacts$/, access: 'read', handle: async ({ user }) => ({ body: (await safety.contacts(user.id)) }) },
    { method: 'POST', path: /^\/api\/safety\/contacts$/, access: 'write', handle: async (ctx) => (await write('contact.add', null, ctx)) },
    { method: 'POST', path: /^\/api\/safety\/contacts\/([a-f0-9-]{36})\/remove$/, access: 'write', handle: async (ctx) => (await write('contact.remove', ctx.match[1], ctx)) },
    { method: 'GET', path: /^\/api\/safety\/rides\/([a-f0-9-]{36})$/, access: 'read', handle: async ({ user, match }) => ({ body: (await safety.trip(user.id, match[1])) }) },
    { method: 'POST', path: /^\/api\/safety\/rides\/([a-f0-9-]{36})\/incidents$/, access: 'write', handle: async (ctx) => (await write('incident.create', ctx.match[1], ctx)) },
    { method: 'POST', path: /^\/api\/safety\/rides\/([a-f0-9-]{36})\/links$/, access: 'write', handle: async (ctx) => (await write('link.create', ctx.match[1], ctx)) },
    { method: 'POST', path: /^\/api\/safety\/links\/([a-f0-9-]{36})\/revoke$/, access: 'write', handle: async (ctx) => (await write('link.revoke', ctx.match[1], ctx)) },
    { method: 'GET', path: /^\/api\/safety\/incidents\/([a-f0-9-]{36})$/, access: 'read', handle: async ({ user, match }) => ({ body: (await safety.get(user.id, match[1])) }) },
    { method: 'GET', path: /^\/api\/admin\/safety$/, access: 'read', role: 'admin', handle: async ({ user, query }) => ({ body: (await safety.list(user.id, query.get('status') ?? 'open', query.get('before'))) }) },
    { method: 'POST', path: /^\/api\/admin\/safety\/([a-f0-9-]{36})\/review$/, access: 'write', role: 'admin', handle: async (ctx) => (await write('incident.review', ctx.match[1], ctx)) },
    { method: 'POST', path: /^\/api\/admin\/safety-notifications\/([a-f0-9-]{36})\/simulate$/, access: 'write', role: 'admin', handle: async (ctx) => (await write('notification.simulate', ctx.match[1], ctx)) },
    { method: 'POST', path: /^\/api\/trip-share\/view$/, access: 'capability', handle: async ({ data }) => ({ body: (await safety.sharedTrip(data)) }) },
  ];
}
