import { check } from '../../shared/errors.mjs';

export function adminOperationsRoutes(operations) {
  return [{ method: 'GET', path: /^\/api\/admin\/console\/operations$/, access: 'read',
    async handle({ user, query }) {
      const entries = [...query.entries()];
      check(new Set(entries.map(([key]) => key)).size === entries.length, 'INVALID_INPUT', 'Do not repeat a filter.');
      return { body: await operations.get(user, Object.fromEntries(entries)) };
    } }];
}
