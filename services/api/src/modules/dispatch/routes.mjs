export function dispatchRoutes(dispatch) {
  return [
    { method: 'POST', path: /^\/api\/dispatch\/offers\/([a-f0-9-]{36})\/decline$/, access: 'write', role: 'driver',
      handle: ({ user, match, key, data }) => ({ body: dispatch.decline({ userId: user.id, offerId: match[1], key, data }) }) },
    { method: 'GET', path: /^\/api\/admin\/dispatch\/metrics$/, access: 'read', role: 'admin',
      handle: ({ user }) => ({ body: dispatch.metrics(user) }) },
  ];
}
