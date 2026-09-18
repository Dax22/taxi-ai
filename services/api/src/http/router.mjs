import { check } from '../shared/errors.mjs';
import { accountRoutes } from '../modules/accounts/routes.mjs';
import { driverRoutes } from '../modules/drivers/routes.mjs';
import { rideRoutes } from '../modules/rides/routes.mjs';
import { chatRoutes } from '../modules/chat/routes.mjs';
import { localOrigin, requireSameOrigin, readSessionToken, requireCsrf } from './security.mjs';
import { readBody } from './body.mjs';
import { json } from './responses.mjs';

/** HTTP owns parsing, cookies, CSRF and response codes; services own decisions. */
export function createApiRouter(application) {
  const { accounts, drivers, rides, chat, rateLimiter, clock } = application;
  const routes = [...accountRoutes(accounts), ...driverRoutes(drivers), ...rideRoutes(rides), ...chatRoutes(chat)];
  return async function handleApi({ request, response, pathname }) {
    const origin = localOrigin(request);
    const write = request.method === 'POST';
    check(['GET', 'POST'].includes(request.method), 'METHOD_NOT_ALLOWED', 'Use GET or POST.');
    requireSameOrigin(request, origin, write);
    const route = routes.find((entry) => entry.method === request.method && entry.path.test(pathname));
    const token = readSessionToken(request.headers.cookie);
    let session = null, data;
    if (route?.access === 'auth') {
      rateLimiter.consume(`auth:${request.socket.remoteAddress}`, clock(), 30, 10 * 60_000);
      data = await readBody(request);
    } else {
      session = accounts.sessionFor(token);
      if (route?.access !== 'public') check(session, 'UNAUTHENTICATED', 'Sign in to continue.');
      if (write) {
        requireCsrf(request, session);
        rateLimiter.consume(`write:${session.user.id}`, clock(), 60, 60_000);
        data = await readBody(request);
      }
    }
    check(route, 'NOT_FOUND', 'API endpoint not found.');
    const result = await route.handle({ data, token, session, user: session?.user,
      match: pathname.match(route.path), key: request.headers['idempotency-key'],
      query: new URL(request.url, origin).searchParams });
    if (result.cookie) response.setHeader('Set-Cookie', result.cookie);
    json(response, result.status ?? 200, { ...result.body, serverNow: clock() });
  };
}
