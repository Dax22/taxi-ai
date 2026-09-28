import { check } from '../../shared/errors.mjs';

function queryValues(query) {
  const entries = [...query.entries()];
  check(new Set(entries.map(([key]) => key)).size === entries.length, 'INVALID_INPUT', 'Do not repeat a filter.');
  return Object.fromEntries(entries);
}
export function adminFinanceRoutes(finance) {
  return [
    { method: 'GET', path: /^\/api\/admin\/console\/finance$/, access: 'read',
      async handle({ user, query }) { return { body: await finance.get(user, queryValues(query)) }; } },
    { method: 'GET', path: /^\/api\/admin\/console\/finance\/([a-f0-9-]{36})$/, access: 'read',
      async handle({ user, match, query }) { return { body: await finance.detail(user, match[1], queryValues(query)) }; } },
  ];
}
