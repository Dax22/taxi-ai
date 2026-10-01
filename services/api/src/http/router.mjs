import { checkoutPaymentRoutes } from '../modules/checkout-payments/routes.mjs';
import { deliveryUpdateRoutes } from '../modules/delivery-updates/routes.mjs';
import { safetyMonitoringRoutes } from '../modules/safety-monitoring/routes.mjs';
import { familyRoutes } from '../modules/family/routes.mjs';
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
import { realtimeResponse, requestAbortSignal } from '../modules/realtime/routes.mjs';
import { authorizeStaffRequest, staffPermission } from './staff-boundary.mjs';
import { staffAccessRoutes } from '../modules/staff-access/routes.mjs';
import { adminCasesRoutes } from '../modules/admin-cases/routes.mjs';
import { adminOperationsRoutes } from '../modules/admin-operations/routes.mjs';
import { adminFinanceRoutes } from '../modules/admin-finance/routes.mjs';
import { adminComplianceRoutes } from '../modules/admin-compliance/routes.mjs';
import { adminDemandRoutes } from '../modules/admin-demand/routes.mjs';
import { parcelTrackingRoutes } from '../modules/parcel-tracking/routes.mjs';
import { announcementRoutes } from '../modules/announcements/routes.mjs';

/** HTTP owns parsing, cookies, CSRF and response codes; services own decisions. */
export function createApiRouter(application, { secure = false } = {}) {
  const { accounts, devices, drivers, rides, chat, calls, locations, availability, payments, safety, rateLimiter, clock } = application;
  const cookie = (token, age) => sessionCookie(token, age, secure);
  const routes = [...accountEmailRoutes(application.accountEmail, cookie), ...googleAuthRoutes(application.googleAuth, accounts, secure), ...adminConsoleRoutes(application.adminConsole, accounts, cookie, application.staffAccess), ...deviceSessionRoutes(devices), ...accountRoutes(accounts, cookie), ...driverRoutes(drivers), ...rideRoutes(rides, application.dispatch), ...dispatchRoutes(application.dispatch), ...chatRoutes(chat), ...callRoutes(calls), ...locationRoutes(locations), ...availabilityRoutes(availability), ...paymentRoutes(payments), ...safetyRoutes(safety)];
  routes.push(...checkoutPaymentRoutes(application.checkoutPayments));
  routes.push(...deliveryUpdateRoutes(application.deliveryUpdates));
  routes.push(...staffAccessRoutes(application.staffAccess), ...adminCasesRoutes(application.adminCases), ...adminOperationsRoutes(application.adminOperations));
  routes.push(...adminFinanceRoutes(application.adminFinance), ...adminComplianceRoutes(application.adminCompliance), ...adminDemandRoutes(application.adminDemand));
  routes.push(...safetyMonitoringRoutes(application.safetyMonitoring));
  routes.push(...vehicleCheckRoutes(application.vehicleChecks));
  routes.push(...eatsRoutes(application.eats));
  routes.push(...guestRideRoutes(application.guestRides));
  routes.push(...parcelTrackingRoutes(application.parcelTracking));
  routes.push(...familyRoutes(application.family));
  routes.push(...announcementRoutes(application.announcements));
  return async function handleApi({ request, response, pathname, origin, clientAddress }) {
    const write = request.method === 'POST';
    check(['GET', 'POST'].includes(request.method), 'METHOD_NOT_ALLOWED', 'Use GET or POST.');
    requireSameOrigin(request, origin, write);
    const route = routes.find((entry) => entry.method === request.method && entry.path.test(pathname));
    const token = readSessionToken(request.headers.cookie, secure);
    let session = null, data;
    if (route?.access === 'capability') {
      (await rateLimiter.consume(`trip-link:${clientAddress}`, clock(), 30, 60_000));
      data = await readBody(request, 1024);
    } else if (route?.access === 'auth') {
      (await rateLimiter.consume(`auth:${clientAddress}`, clock(), 30, 10 * 60_000));
      data = await readBody(request);
    } else {
      session = (await accounts.sessionFor(token));
      if (route?.access !== 'public') check(session, 'UNAUTHENTICATED', 'Sign in to continue.');
      if (route?.role) check(hasCapability(session?.user, route.role), 'FORBIDDEN', `The ${route.role} capability is required.`);
      if (pathname === '/api/family' || pathname.startsWith('/api/family/')) {
        await rateLimiter.consume(`family:${session.user.id}`, clock(), 120, 60_000);
        if (write && pathname === '/api/family/invite') await rateLimiter.consume(`family-invite:${session.user.id}`, clock(), 10, 60_000);
      }
      if (route?.documentDownload) (await rateLimiter.consume(`document:${session.user.id}`, clock(), 30, 60_000));
      if (write) {
        requireCsrf(request, session);
        (await rateLimiter.consume(`write:${session.user.id}`, clock(), 60, 60_000));
        data = await readBody(request, route?.maxBodyBytes);
        session = (await accounts.sessionFor(token));
        check(session, 'UNAUTHENTICATED', 'Sign in to continue.');
        requireCsrf(request, session);
        if (route?.role) check(hasCapability(session.user, route.role), 'FORBIDDEN', `The ${route.role} capability is required.`);
      }
    }
    if (!write && pathname === '/api/events') {
      const abort = requestAbortSignal(response);
      try {
        const body = await realtimeResponse(application.realtime, { userId: session.user.id,
          query: new URL(request.url, origin).searchParams, signal: abort.signal,
          authorize: () => accounts.sessionFor(token) });
        if (!response.destroyed) json(response, 200, { ...body, serverNow: clock() });
      } finally { abort.dispose(); }
      return;
    }
    check(route, 'NOT_FOUND', 'API endpoint not found.');
    const staffRequest = staffPermission(pathname, session?.user);
    if (staffRequest) {
      await rateLimiter.consume(`staff-read:${session.user.id}`, clock(), 120, 60_000);
      if (write && pathname.includes('/staff/mfa/')) await rateLimiter.consume(`staff-factor:${session.user.id}`, clock(), 5, 5 * 60_000);
      await authorizeStaffRequest(application.staffAccess, session.user, token, pathname);
    }
    const context = { data, token, session, user: session?.user, origin, cookieHeader: request.headers.cookie,
      match: pathname.match(route.path), key: request.headers['idempotency-key'], callClient: request.headers['x-call-client'],
      locationClient: request.headers['x-location-client'],
      availabilityClient: request.headers['x-availability-client'],
      query: new URL(request.url, origin).searchParams, reauthenticate: async () => { const fresh = (await accounts.sessionFor(token)); check(fresh, 'UNAUTHENTICATED', 'Sign in to continue.'); if (write) requireCsrf(request, fresh); return fresh.user; } };
    const result = staffRequest && write ? await application.staffAccess.withSession(session.user.id, token, async () => {
      await authorizeStaffRequest(application.staffAccess, session.user, token, pathname);
      return await route.handle(context);
    }) : await route.handle(context);
    if (staffRequest) {
      const fresh = await accounts.sessionFor(token);
      check(fresh?.user.id === session.user.id, 'UNAUTHENTICATED', 'Sign in to continue.');
      await authorizeStaffRequest(application.staffAccess, fresh.user, token, pathname);
    }
    if (result.cookie) response.setHeader('Set-Cookie', result.cookie);
    if (result.image) {
      response.writeHead(200, { 'Content-Type': result.image.mimeType, 'Content-Length': result.image.content.length });
      response.end(result.image.content); return;
    }
    json(response, result.status ?? 200, { ...result.body, serverNow: clock() });
  };
}
