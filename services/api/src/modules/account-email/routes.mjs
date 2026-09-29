export function accountEmailRoutes(email, cookie) {
  return [
    { method: 'GET', path: /^\/api\/auth\/email-settings$/, access: 'public', handle: async () => ({ body: (await email.settings()) }) },
    { method: 'GET', path: /^\/api\/account\/email$/, access: 'read', role: 'customer', handle: async ({ user }) => ({ body: (await email.status(user.id)) }) },
    { method: 'POST', path: /^\/api\/account\/email\/request$/, access: 'write', role: 'customer', handle: async ({ user, data }) => ({ body: (await email.requestVerification(user.id,data)) }) },
    { method: 'POST', path: /^\/api\/auth\/password\/request$/, access: 'auth', handle: async ({ data }) => ({ body: (await email.requestReset(data)) }) },
    { method: 'POST', path: /^\/api\/auth\/email\/verify$/, access: 'auth', handle: async ({ data }) => ({ body: (await email.verify(data)) }) },
    { method: 'POST', path: /^\/api\/auth\/password\/reset$/, access: 'auth', async handle({ data }) {
      const body = await email.reset(data); return { body, cookie: (await cookie('',0)) };
    } },
  ];
}
