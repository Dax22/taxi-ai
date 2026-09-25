export function dispatchRoutes(dispatch) {
  return [
    { method: 'POST', path: /^\/api\/dispatch\/offers\/([a-f0-9-]{36})\/decline$/, access: 'write', role: 'driver',
      handle: async ({ user, match, key, data }) => ({ body: (await dispatch.decline({ userId: user.id, offerId: match[1], key, data })) }) },
    { method: 'GET', path: /^\/api\/admin\/dispatch\/metrics$/, access: 'read', role: 'admin',
      handle: async ({ user }) => ({ body: (await dispatch.metrics(user)) }) },
  ];
}
