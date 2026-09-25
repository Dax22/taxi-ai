export function rideRoutes(rides, dispatch) {
  function write(action, id, context) {
    const result = rides.mutate({ userId: context.user.id, key: context.key, action, id, data: context.data });
    return { status: action === 'create' && !result.replayed ? 201 : 200, body: result };
  }
  return [
    { method: 'GET', path: /^\/api\/rides$/, access: 'read', handle: async ({ user, query, reauthenticate }) => {
      if (query.get('mode') !== 'customer' && user.driver?.status === 'approved') await dispatch?.refresh();
      return { body: rides.list(reauthenticate ? reauthenticate() : user, query.get('mode')) };
    } },
    { method: 'GET', path: /^\/api\/rides\/history$/, access: 'read',
      handle: ({ user, query }) => ({ body: rides.history(user, query.get('before'), query.get('mode')) }) },
    { method: 'POST', path: /^\/api\/rides$/, access: 'write', handle: (context) => write('create', null, context) },
    { method: 'GET', path: /^\/api\/rides\/([a-f0-9-]{36})$/, access: 'read',
      handle: ({ user, match }) => ({ body: { ride: rides.get(user, match[1]) } }) },
    { method: 'POST', path: /^\/api\/rides\/([a-f0-9-]{36})\/rating$/, access: 'write',
      handle: ({ user, match, data }) => ({ body: rides.rate(user, match[1], data) }) },
    { method: 'POST', path: /^\/api\/rides\/([a-f0-9-]{36})\/(claim|offers|accept|cancel|confirm|depart|arrive|start|complete)$/, access: 'write',
      handle: (context) => write(context.match[2] === 'offers' ? 'propose' : context.match[2], context.match[1], context) },
  ];
}
