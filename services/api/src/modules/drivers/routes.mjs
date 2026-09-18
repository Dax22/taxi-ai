export function driverRoutes(drivers) {
  return [
    { method: 'GET', path: /^\/api\/admin\/drivers$/, access: 'read',
      handle: ({ user }) => ({ body: { drivers: drivers.list(user) } }) },
    { method: 'POST', path: /^\/api\/admin\/drivers\/([a-f0-9-]{36})\/review$/, access: 'write',
      handle: ({ user, match, data }) => ({ body: { driver: drivers.review(user, match[1], data) } }) },
  ];
}
