import { safetyMonitoringRoutes } from '../modules/safety-monitoring/routes.mjs';
import { deviceSessionRoutes } from '../modules/device-sessions/routes.mjs';
import { check } from '../shared/errors.mjs';
import { hasCapability } from '../shared/policies.mjs';
import { accountRoutes } from '../modules/accounts/routes.mjs';
import { driverRoutes } from '../modules/drivers/routes.mjs';
import { rideRoutes } from '../modules/rides/routes.mjs';
import { dispatchRoutes } from '../modules/dispatch/routes.mjs';
import { chatRoutes } from '../modules/chat/routes.mjs';
import { callRoutes } from '../modules/calls/routes.mjs';
import { locationRoutes } from '../modules/locations/routes.mjs';
import { availabilityRoutes } from '../modules/availability/routes.mjs';
import { safetyRoutes } from '../modules/safety/routes.mjs';
import { guestRideRoutes } from '../modules/guest-rides/routes.mjs';
import { vehicleCheckRoutes } from '../modules/vehicle-checks/routes.mjs';
import { paymentRoutes } from '../modules/payments/routes.mjs';
import { adminConsoleRoutes } from '../modules/admin-console/routes.mjs';
import { googleAuthRoutes } from '../modules/google-auth/routes.mjs';
import { accountEmailRoutes } from '../modules/account-email/routes.mjs';
import { eatsRoutes } from '../modules/eats/routes.mjs';
import { requireSameOrigin, readSessionToken, sessionCookie, requireCsrf } from './security.mjs';
import { readBody } from './body.mjs';
import { json } from './responses.mjs';

/** HTTP owns parsing, cookies, CSRF and response codes; services own decisions. */
export function createApiRouter(application, { secure = false } = {}) {
  const { accounts, devices, drivers, rides, chat, calls, locations, availability, payments, safety, rateLimiter, clock } = application;
  const cookie = (token, age) => sessionCookie(token, age, secure);
  const routes = [...accountEmailRoutes(application.accountEmail, cookie), ...googleAuthRoutes(application.googleAuth, accounts, secure), ...adminConsoleRoutes(application.adminConsole, accounts, cookie), ...deviceSessionRoutes(devices), ...accountRoutes(accounts, cookie), ...driverRoutes(drivers), ...rideRoutes(rides, application.dispatch), ...dispatchRoutes(application.dispatch), ...chatRoutes(chat), ...callRoutes(calls), ...locationRoutes(locations), ...availabilityRoutes(availability), ...paymentRoutes(payments), ...safetyRoutes(safety)];
  routes.push(...safetyMonitoringRoutes(application.safetyMonitoring));
  routes.push(...vehicleCheckRoutes(application.vehicleChecks));
  routes.push(...eatsRoutes(application.eats));
  routes.push(...guestRideRoutes(application.guestRides));
  return async function handleApi({ request, response, pathname, origin, clientAddress }) {
    const write = request.method === 'POST';
    check(['GET', 'POST'].includes(request.method), 'METHOD_NOT_ALLOWED', 'Use GET or POST.');
    requireSameOrigin(request, origin, write);
    const route = routes.find((entry) => entry.method === request.method && entry.path.test(pathname));
    const token = readSessionToken(request.headers.cookie, secure);
    let session = null, data;
    if (route?.access === 'capability') {
      rateLimiter.consume(`trip-link:${clientAddress}`, clock(), 30, 60_000);
      data = await readBody(request, 1024);
    } else if (route?.access === 'auth') {
      rateLimiter.consume(`auth:${clientAddress}`, clock(), 30, 10 * 60_000);
      data = await readBody(request);
    } else {
      session = accounts.sessionFor(token);
      if (route?.access !== 'public') check(session, 'UNAUTHENTICATED', 'Sign in to continue.');
      if (route?.role) check(hasCapability(session?.user, route.role), 'FORBIDDEN', `The ${route.role} capability is required.`);
      if (route?.documentDownload) rateLimiter.consume(`document:${session.user.id}`, clock(), 30, 60_000);
      if (write) {
        requireCsrf(request, session);
        rateLimiter.consume(`write:${session.user.id}`, clock(), 60, 60_000);
        data = await readBody(request, route?.maxBodyBytes);
        session = accounts.sessionFor(token);
        check(session, 'UNAUTHENTICATED', 'Sign in to continue.');
        requireCsrf(request, session);
        if (route?.role) check(hasCapability(session.user, route.role), 'FORBIDDEN', `The ${route.role} capability is required.`);
      }
    }
    check(route, 'NOT_FOUND', 'API endpoint not found.');
    const result = await route.handle({ data, token, session, user: session?.user, origin, cookieHeader: request.headers.cookie,
      match: pathname.match(route.path), key: request.headers['idempotency-key'], callClient: request.headers['x-call-client'],
      locationClient: request.headers['x-location-client'],
      availabilityClient: request.headers['x-availability-client'],
      query: new URL(request.url, origin).searchParams, reauthenticate: () => { const fresh = accounts.sessionFor(token); check(fresh, 'UNAUTHENTICATED', 'Sign in to continue.'); if (write) requireCsrf(request, fresh); return fresh.user; } });
    if (result.cookie) response.setHeader('Set-Cookie', result.cookie);
    if (result.image) {
      response.writeHead(200, { 'Content-Type': result.image.mimeType, 'Content-Length': result.image.content.length });
      response.end(result.image.content); return;
    }
    json(response, result.status ?? 200, { ...result.body, serverNow: clock() });
  };
}
