export function rideRoutes(rides, dispatch) {
  async function write(action, id, context) {
    const result = (await rides.mutate({ userId: context.user.id, key: context.key, action, id, data: context.data }));
    return { status: action === 'create' && !result.replayed ? 201 : 200, body: result };
  }
  return [
    { method: 'GET', path: /^\/api\/rides$/, access: 'read', handle: async ({ user, query, reauthenticate }) => {
      if (query.get('mode') !== 'customer' && user.driver?.status === 'approved') await dispatch?.refresh();
      return { body: (await rides.list(reauthenticate ? (await reauthenticate()) : user, query.get('mode'))) };
    } },
    { method: 'GET', path: /^\/api\/rides\/history$/, access: 'read',
      handle: async ({ user, query }) => ({ body: (await rides.history(user, query.get('before'), query.get('mode'))) }) },
    { method: 'POST', path: /^\/api\/rides$/, access: 'write', handle: async (context) => (await write('create', null, context)) },
    { method: 'GET', path: /^\/api\/rides\/([a-f0-9-]{36})$/, access: 'read',
      handle: async ({ user, match }) => ({ body: { ride: (await rides.get(user, match[1])) } }) },
    { method: 'POST', path: /^\/api\/rides\/([a-f0-9-]{36})\/rating$/, access: 'write',
      handle: async ({ user, match, data }) => ({ body: (await rides.rate(user, match[1], data)) }) },
    { method: 'POST', path: /^\/api\/rides\/([a-f0-9-]{36})\/(claim|offers|accept|cancel|confirm|depart|arrive|start|complete)$/, access: 'write',
      handle: async (context) => (await write(context.match[2] === 'offers' ? 'propose' : context.match[2], context.match[1], context)) },
  ];
}
