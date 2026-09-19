export function paymentRoutes(payments) {
  return [
    { method: 'GET', path: /^\/api\/payments\/rides\/([a-f0-9-]{36})$/, access: 'read',
      handle: ({ user, match }) => ({ body: payments.get(user.id, match[1]) }) },
    { method: 'GET', path: /^\/api\/payments\/rides\/([a-f0-9-]{36})\/receipt$/, access: 'read',
      handle: ({ user, match }) => ({ body: payments.receipt(user.id, match[1]) }) },
    { method: 'POST', path: /^\/api\/payments\/rides\/([a-f0-9-]{36})\/start$/, access: 'write',
      handle: ({ user, match, key, data }) => ({ body: payments.command({ userId: user.id, rideId: match[1], action: 'start', key, data }) }) },
    { method: 'POST', path: /^\/api\/payments\/rides\/([a-f0-9-]{36})\/attempts\/([a-f0-9-]{36})\/simulate$/, access: 'write',
      handle: ({ user, match, key, data }) => ({ body: payments.command({ userId: user.id, rideId: match[1], attemptId: match[2], action: 'simulate', key, data }) }) },
    { method: 'GET', path: /^\/api\/driver\/earnings$/, access: 'read',
      handle: ({ user, query }) => ({ body: payments.earnings(user.id, query.get('before')) }) },
    { method: 'GET', path: /^\/api\/admin\/payments$/, access: 'read',
      handle: ({ user, query }) => ({ body: payments.transactions(user.id, query.get('before')) }) },
  ];
}
