import { check } from '../../shared/errors.mjs';
export function adminSafetyAlertRoutes(service) {
  return [
    { method: 'GET', path: /^\/api\/admin\/console\/safety-alerts$/, access: 'read',
      handle: async c => ({ body: await service.list(c.user.id, Object.fromEntries(c.query)) }) },
    { method: 'GET', path: /^\/api\/admin\/console\/safety-alerts\/([a-f0-9-]{36})$/, access: 'read',
      handle: async c => ({ body: await service.get(c.user.id, c.match[1], Object.fromEntries(c.query)) }) },
    { method: 'POST', path: /^\/api\/admin\/console\/safety-alerts\/([a-f0-9-]{36})$/, access: 'write',
      async handle(c) {
        check([...c.query.keys()].length === 0, 'INVALID_FIELDS', 'Review actions do not accept query parameters.');
        const fresh = await c.reauthenticate(); check(fresh.id === c.user.id, 'UNAUTHENTICATED', 'Sign in again.');
        return { body: await service.command({ userId: c.user.id, id: c.match[1], data: c.data, key: c.key }) };
      } },
  ];
}
