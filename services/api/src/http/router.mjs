import { check } from '../shared/errors.mjs';
import { accountRoutes } from '../modules/accounts/routes.mjs';
import { driverRoutes } from '../modules/drivers/routes.mjs';
import { rideRoutes } from '../modules/rides/routes.mjs';
import { chatRoutes } from '../modules/chat/routes.mjs';
import { callRoutes } from '../modules/calls/routes.mjs';
import { locationRoutes } from '../modules/locations/routes.mjs';
import { availabilityRoutes } from '../modules/availability/routes.mjs';
import { paymentRoutes } from '../modules/payments/routes.mjs';
import { requireSameOrigin, readSessionToken, sessionCookie, requireCsrf } from './security.mjs';
import { readBody } from './body.mjs';
import { json } from './responses.mjs';

/** HTTP owns parsing, cookies, CSRF and response codes; services own decisions. */
export function createApiRouter(application, { secure = false } = {}) {
  const { accounts, drivers, rides, chat, calls, locations, availability, payments, rateLimiter, clock } = application;
  const routes = [...accountRoutes(accounts, (token, age) => sessionCookie(token, age, secure)), ...driverRoutes(drivers), ...rideRoutes(rides), ...chatRoutes(chat), ...callRoutes(calls), ...locationRoutes(locations), ...availabilityRoutes(availability), ...paymentRoutes(payments)];
  return async function handleApi({ request, response, pathname, origin, clientAddress }) {
    const write = request.method === 'POST';
    check(['GET', 'POST'].includes(request.method), 'METHOD_NOT_ALLOWED', 'Use GET or POST.');
    requireSameOrigin(request, origin, write);
    const route = routes.find((entry) => entry.method === request.method && entry.path.test(pathname));
    const token = readSessionToken(request.headers.cookie, secure);
    let session = null, data;
    if (route?.access === 'auth') {
      rateLimiter.consume(`auth:${clientAddress}`, clock(), 30, 10 * 60_000);
      data = await readBody(request);
    } else {
      session = accounts.sessionFor(token);
      if (route?.access !== 'public') check(session, 'UNAUTHENTICATED', 'Sign in to continue.');
      if (route?.role) check(session?.user.role === route.role, 'FORBIDDEN', `A ${route.role} account is required.`);
      if (route?.documentDownload) rateLimiter.consume(`document:${session.user.id}`, clock(), 30, 60_000);
      if (write) {
        requireCsrf(request, session);
        rateLimiter.consume(`write:${session.user.id}`, clock(), 60, 60_000);
        data = await readBody(request, route?.maxBodyBytes);
        session = accounts.sessionFor(token);
        check(session, 'UNAUTHENTICATED', 'Sign in to continue.');
        requireCsrf(request, session);
        if (route?.role) check(session.user.role === route.role, 'FORBIDDEN', `A ${route.role} account is required.`);
      }
    }
    check(route, 'NOT_FOUND', 'API endpoint not found.');
    const result = await route.handle({ data, token, session, user: session?.user,
      match: pathname.match(route.path), key: request.headers['idempotency-key'], callClient: request.headers['x-call-client'],
      locationClient: request.headers['x-location-client'],
      availabilityClient: request.headers['x-availability-client'],
      query: new URL(request.url, origin).searchParams });
    if (result.cookie) response.setHeader('Set-Cookie', result.cookie);
    json(response, result.status ?? 200, { ...result.body, serverNow: clock() });
  };
}
