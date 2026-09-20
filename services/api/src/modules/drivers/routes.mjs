export function driverRoutes(drivers) {
  return [
    { method: 'GET', path: /^\/api\/driver\/application$/, access: 'read', role: 'driver',
      handle: ({ user }) => ({ body: { application: drivers.get(user, user.id) } }) },
    ...['save', 'upload', 'remove', 'submit', 'reopen'].map((action) => ({
      method: 'POST', path: new RegExp(`^/api/driver/application/${action}$`), access: 'write', role: 'driver',
      ...(action === 'upload' ? { maxBodyBytes: 2_800_000 } : {}),
      handle: ({ user, data, key }) => ({ body: drivers.command(user, user.id, action, data, key) }) })),
    { method: 'GET', path: /^\/api\/driver-documents\/([a-f0-9-]{36})$/, access: 'read', documentDownload: true,
      handle: ({ user, match }) => ({ body: drivers.download(user, match[1]) }) },
    { method: 'GET', path: /^\/api\/admin\/drivers$/, access: 'read', role: 'admin',
      handle: ({ user }) => ({ body: { drivers: drivers.list(user) } }) },
    { method: 'GET', path: /^\/api\/admin\/drivers\/([a-f0-9-]{36})$/, access: 'read', role: 'admin',
      handle: ({ user, match }) => ({ body: { application: drivers.get(user, match[1]) } }) },
    { method: 'POST', path: /^\/api\/admin\/drivers\/([a-f0-9-]{36})\/review$/, access: 'write', role: 'admin',
      handle: ({ user, match, data, key }) => ({ body: drivers.command(user, match[1], 'review', data, key) }) },
  ];
}
