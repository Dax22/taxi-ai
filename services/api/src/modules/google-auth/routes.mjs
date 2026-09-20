import { googleCookie, readGoogleCookie } from '../../http/google-cookie.mjs';
import { sessionCookie } from '../../http/security.mjs';
import { check } from '../../shared/errors.mjs';

export function googleAuthRoutes(google, accounts, secure = false) {
  return [
    { method: 'GET', path: /^\/api\/auth\/providers$/, access: 'public', handle: () => ({ body: { google: google.settings() } }) },
    ...[false, true].map((link) => ({ method: 'POST', path: link ? /^\/api\/account\/google\/link$/ : /^\/api\/auth\/google\/start$/,
      access: link ? 'write' : 'auth', ...(link ? { role: 'customer' } : {}),
      async handle({ data, token, origin, cookieHeader }) {
        const result = await google.startWeb({ data, token, origin, link, previousBinding: readGoogleCookie(cookieHeader, secure) });
        return { cookie: googleCookie(result.binding, secure), body: { redirectUrl: result.redirectUrl } };
      } })),
    { method: 'GET', path: /^\/api\/account\/sign-in-methods$/, access: 'read', role: 'customer',
      handle: ({ user }) => ({ body: { methods: accounts.signInMethods(user.id), google: google.settings() } }) },
    { method: 'POST', path: /^\/api\/account\/google\/unlink$/, access: 'write', role: 'customer',
      async handle({ user, data, token }) {
        const body = await accounts.unlinkGoogle(user.id, data, token);
        return { body, cookie: sessionCookie('', 0, secure) };
      } },
  ];
}

/** The sole cross-site return endpoint. State + HttpOnly binding replace Origin.
 * Only allowlisted outcomes reach the URL. Codes and tokens never reach app JS. */
export function createGoogleCallback({ googleAuth, accounts, rateLimiter, clock }, secure = false) {
  const outcomes = new Map([['GOOGLE_CANCELLED','cancelled'], ['GOOGLE_ACCOUNT_EXISTS','existing'],
    ['GOOGLE_ACCOUNT_CONFLICT','conflict'], ['UNAUTHENTICATED','session'], ['FORBIDDEN','staff']]);
  return async ({ request, response, origin, clientAddress }) => {
    check(request.method === 'GET', 'METHOD_NOT_ALLOWED', 'Use GET.');
    rateLimiter.consume(`google-return:${clientAddress}`, clock(), 30, 10 * 60_000);
    const cookies = [googleCookie('', secure, 0)];
    let destination;
    try {
      const query = new URL(request.url, origin).searchParams;
      for (const key of ['state', 'code', 'error']) check(query.getAll(key).length <= 1, 'INVALID_GOOGLE_ATTEMPT', 'Start Google sign-in again.');
      const result = await googleAuth.finishWeb({ state: query.get('state'), code: query.get('code'),
        error: query.get('error'), binding: readGoogleCookie(request.headers.cookie, secure), origin });
      if (result.linked) destination = '/account-access?google=connected';
      else {
        const session = accounts.issueSession(result.user.id);
        cookies.push(sessionCookie(session.token, session.maxAgeSeconds, secure));
        destination = '/app?google=success';
      }
    } catch (error) { destination = `/app?google=${outcomes.get(error.code) ?? 'retry'}`; }
    response.writeHead(303, { Location: destination, 'Set-Cookie': cookies }); response.end();
  };
}
