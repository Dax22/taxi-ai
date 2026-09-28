import { check } from '../../shared/errors.mjs';

function queryFields(query) {
  const entries = [...query.entries()];
  check(new Set(entries.map(([key]) => key)).size === entries.length, 'INVALID_INPUT', 'Do not repeat a filter.');
  return Object.fromEntries(entries);
}
export function adminCasesRoutes(cases) {
  const prefix = '/api/admin/console/cases';
  return [
    { method: 'GET', path: new RegExp(`^${prefix}$`), access: 'read',
      handle: async ({ user, query }) => ({ body: await cases.list(user.id, queryFields(query)) }) },
    { method: 'GET', path: new RegExp(`^${prefix}/([a-f0-9-]{36})$`), access: 'read',
      handle: async ({ user, match, query }) => ({ body: await cases.get(user.id, match[1], queryFields(query)) }) },
    { method: 'POST', path: new RegExp(`^${prefix}$`), access: 'write',
      handle: async ({ user, data, key }) => ({ status: 201, body: await cases.command({ userId: user.id, action: 'create', data, key }) }) },
    { method: 'POST', path: new RegExp(`^${prefix}/([a-f0-9-]{36})/(assign|note|status|priority)$`), access: 'write',
      handle: async ({ user, match, data, key }) => ({ body: await cases.command({ userId: user.id, id: match[1], action: match[2], data, key }) }) },
  ];
}
