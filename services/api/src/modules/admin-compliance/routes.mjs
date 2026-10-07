import { check } from '../../shared/errors.mjs';

function queryFields(query) {
  const entries = [...query.entries()];
  check(new Set(entries.map(([key]) => key)).size === entries.length, 'INVALID_INPUT', 'Do not repeat a filter.');
  return Object.fromEntries(entries);
}
export function adminComplianceRoutes(compliance) {
  const prefix = '/api/admin/console/compliance';
  return [
    { method: 'GET', path: new RegExp(`^${prefix}$`), access: 'read',
      handle: async ({ user, query }) => ({ body: await compliance.list(user.id, queryFields(query)) }) },
    { method: 'GET', path: new RegExp(`^${prefix}/([a-f0-9-]{36})$`), access: 'read',
      handle: async ({ user, match, query }) => ({ body: await compliance.get(user.id, match[1], queryFields(query)) }) },
    { method: 'GET', path: new RegExp(`^${prefix}/([a-f0-9-]{36})/documents/([a-f0-9-]{36})$`), access: 'read',
      handle: async ({ user, match }) => ({ body: await compliance.document(user.id, match[1], match[2]) }) },
    { method: 'POST', path: new RegExp(`^${prefix}/([a-f0-9-]{36})/approve-exception$`), access: 'write',
      handle: async ({ user, match, data, key }) => ({ body: await compliance.approveException({ userId: user.id, id: match[1], data, key }) }) },
    { method: 'POST', path: new RegExp(`^${prefix}/([a-f0-9-]{36})/(follow-up|complete)$`), access: 'write',
      handle: async ({ user, match, data, key }) => ({ body: await compliance.command({ userId: user.id, id: match[1], action: match[2], data, key }) }) },
  ];
}
