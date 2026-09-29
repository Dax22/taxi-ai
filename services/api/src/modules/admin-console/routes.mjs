import { requireRole } from '../../shared/policies.mjs';
import { check } from '../../shared/errors.mjs';

function queryFields(query) {
  const entries = [...query.entries()];
  check(new Set(entries.map(([key]) => key)).size === entries.length, 'INVALID_INPUT', 'Do not repeat a filter.');
  return Object.fromEntries(entries);
}
export function adminConsoleRoutes(console, accounts, cookie, access) {
  const staff = (user) => ({ id: user.id, name: user.name, email: user.email });
  return [
    { method: 'POST', path: /^\/api\/admin\/console\/login$/, access: 'auth',
      async handle({ data, token }) {
        const user = await accounts.login(data);
        if (access) await access.describe(user.id); else requireRole(user, 'admin');
        const session = (await accounts.issueSession(user.id, token, user));
        return { cookie: (await cookie(session.token, session.maxAgeSeconds)), body: { user: staff(user), csrfToken: session.csrfToken } };
      } },
    { method: 'GET', path: /^\/api\/admin\/console\/session$/, access: 'read',
      handle: async ({ user, session, token }) => ({ body: { user: staff(user), csrfToken: session.csrfToken,
        ...(access ? { staff: await access.describe(user.id, { sessionToken: token }) } : {}) } }) },
    ...['accounts', 'trips', 'analytics'].map((name) => ({ method: 'GET', path: new RegExp(`^/api/admin/console/${name}$`), access: 'read',
      handle: async ({ user, query }) => ({ body: (await console[name](user, queryFields(query))) }) })),
    { method: 'GET', path: /^\/api\/admin\/console\/accounts\/([a-f0-9-]{36})$/, access: 'read',
      handle: async ({ user, match, query }) => ({ body: (await console.account(user, match[1], queryFields(query))) }) },
    { method: 'GET', path: /^\/api\/admin\/console\/trips\/([a-f0-9-]{36})$/, access: 'read',
      handle: async ({ user, match, query }) => {
        check([...query.keys()].length === 0, 'INVALID_INPUT', 'Trip details do not accept filters.');
        return { body: (await console.trip(user, match[1])) };
      } },
  ];
}
