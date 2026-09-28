import { sessionCookie } from '../../http/security.mjs';

export function accountRoutes(accounts, cookie = sessionCookie) {
  return [
    { method: 'GET', path: /^\/api\/account\/kemmy-setup$/,
      handle: async ({ user }) => ({ body: (await accounts.kemmySetup(user.id)) }) },
    { method: 'POST', path: /^\/api\/account\/kemmy-setup$/, access: 'write',
      handle: async ({ user, data }) => ({ body: (await accounts.updateKemmySetup(user.id, data)) }) },
    { method: 'POST', path: /^\/api\/account\/driver-profile\/delete$/, access: 'write',
      handle: async ({ user, data, key }) => ({ body: (await accounts.deleteDriverProfile(user.id, data, key)) }) },
    { method: 'POST', path: /^\/api\/account\/driver-profile$/, access: 'write',
      handle: async ({ user, data, key }) => ({ body: (await accounts.addDriverProfile(user.id, data, key)) }) },
    ...['register', 'login'].map((action) => ({
      method: 'POST', path: new RegExp(`^/api/auth/${action}$`), access: 'auth',
      async handle({ data, token }) {
        const user = await accounts[action](data);
        const session = (await accounts.issueSession(user.id, token, action === 'login' ? user : null));
        return { status: action === 'register' ? 201 : 200,
          cookie: (await cookie(session.token, session.maxAgeSeconds)), body: { user, csrfToken: session.csrfToken } };
      },
    })),
    { method: 'GET', path: /^\/api\/session$/, access: 'public',
      handle: ({ session }) => ({ body: { user: session?.user ?? null, csrfToken: session?.csrfToken ?? null } }) },
    { method: 'POST', path: /^\/api\/auth\/logout$/, access: 'write',
      async handle({ token }) {
        (await accounts.revokeSession(token));
        return { cookie: (await cookie('', 0)), body: { ok: true } };
      } },
  ];
}
