import { sessionCookie } from '../../http/security.mjs';

export function accountRoutes(accounts, cookie = sessionCookie) {
  return [
    { method: 'POST', path: /^\/api\/account\/driver-profile$/, access: 'write',
      handle: ({ user, data, key }) => ({ body: accounts.addDriverProfile(user.id, data, key) }) },
    ...['register', 'login'].map((action) => ({
      method: 'POST', path: new RegExp(`^/api/auth/${action}$`), access: 'auth',
      async handle({ data, token }) {
        const user = await accounts[action](data);
        const session = accounts.issueSession(user.id, token);
        return { status: action === 'register' ? 201 : 200,
          cookie: cookie(session.token, session.maxAgeSeconds), body: { user, csrfToken: session.csrfToken } };
      },
    })),
    { method: 'GET', path: /^\/api\/session$/, access: 'public',
      handle: ({ session }) => ({ body: { user: session?.user ?? null, csrfToken: session?.csrfToken ?? null } }) },
    { method: 'POST', path: /^\/api\/auth\/logout$/, access: 'write',
      handle({ token }) {
        accounts.revokeSession(token);
        return { cookie: cookie('', 0), body: { ok: true } };
      } },
  ];
}
