export function driverRoutes(drivers) {
  return [
    { method: 'GET', path: /^\/api\/driver\/application$/, access: 'read', role: 'driver',
      handle: async ({ user }) => ({ body: { application: (await drivers.get(user, user.id)) } }) },
    ...['save', 'upload', 'remove', 'submit', 'reopen', 'face-check'].map((action) => ({
      method: 'POST', path: new RegExp(`^/api/driver/application/${action}$`), access: 'write', role: 'driver',
      ...(action === 'upload' ? { maxBodyBytes: 2_800_000 } : {}),
      handle: async ({ user, data, key, reauthenticate }) => ({ body: (await drivers.command(user, user.id, action, data, key, reauthenticate)) }) })),
    { method: 'GET', path: /^\/api\/driver-documents\/([a-f0-9-]{36})$/, access: 'read', documentDownload: true,
      handle: async ({ user, match }) => ({ body: (await drivers.download(user, match[1])) }) },
    { method: 'GET', path: /^\/api\/admin\/drivers$/, access: 'read', role: 'admin',
      handle: async ({ user }) => ({ body: { drivers: (await drivers.list(user)) } }) },
    { method: 'GET', path: /^\/api\/admin\/drivers\/([a-f0-9-]{36})$/, access: 'read', role: 'admin',
      handle: async ({ user, match }) => ({ body: { application: (await drivers.get(user, match[1])) } }) },
    { method: 'POST', path: /^\/api\/admin\/drivers\/([a-f0-9-]{36})\/review$/, access: 'write', role: 'admin',
      handle: async ({ user, match, data, key }) => ({ body: (await drivers.command(user, match[1], 'review', data, key)) }) },
  ];
}
