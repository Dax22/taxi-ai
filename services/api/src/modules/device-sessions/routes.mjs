/** Cookie-authenticated account recovery; the standard router enforces CSRF. */
export function deviceSessionRoutes(devices) {
  return [
    { method: 'GET', path: /^\/api\/account\/devices$/, access: 'read', role: 'customer',
      handle: ({ user }) => ({ body: { devices: devices.list(user) } }) },
    { method: 'POST', path: /^\/api\/account\/devices\/([a-f0-9-]{36})\/revoke$/, access: 'write', role: 'customer',
      handle: ({ user, match }) => ({ body: devices.revoke(user, match[1]) }) },
  ];
}
