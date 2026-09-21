export function accountEmailRoutes(email, cookie) {
  return [
    { method: 'GET', path: /^\/api\/auth\/email-settings$/, access: 'public', handle: () => ({ body: email.settings() }) },
    { method: 'GET', path: /^\/api\/account\/email$/, access: 'read', role: 'customer', handle: ({ user }) => ({ body: email.status(user.id) }) },
    { method: 'POST', path: /^\/api\/account\/email\/request$/, access: 'write', role: 'customer', handle: ({ user, data }) => ({ body: email.requestVerification(user.id,data) }) },
    { method: 'POST', path: /^\/api\/auth\/password\/request$/, access: 'auth', handle: ({ data }) => ({ body: email.requestReset(data) }) },
    { method: 'POST', path: /^\/api\/auth\/email\/verify$/, access: 'auth', handle: ({ data }) => ({ body: email.verify(data) }) },
    { method: 'POST', path: /^\/api\/auth\/password\/reset$/, access: 'auth', async handle({ data }) {
      const body = await email.reset(data); return { body, cookie: cookie('',0) };
    } },
  ];
}
