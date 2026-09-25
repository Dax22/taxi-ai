import { check } from '../../shared/errors.mjs';

export function adminDemandRoutes(demand) {
  return [{ method: 'GET', path: /^\/api\/admin\/console\/demand$/, access: 'read',
    async handle({ user, query }) {
      const entries = [...query.entries()];
      check(new Set(entries.map(([key]) => key)).size === entries.length, 'INVALID_INPUT', 'Do not repeat a filter.');
      return { body: await demand.get(user, Object.fromEntries(entries)) };
    } }];
}
