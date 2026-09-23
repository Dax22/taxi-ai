import { safetyMonitoringRoutes } from '../modules/safety-monitoring/routes.mjs';
import { MOBILE_API_VERSION } from '../../../../packages/shared/src/mobile-contracts.mjs';
import { check } from '../shared/errors.mjs';
import { fields } from '../shared/validation.mjs';
import { hasCapability } from '../shared/policies.mjs';
import { readBody } from './body.mjs';
import { json } from './responses.mjs';
import { createMobileJourneys, mobileNotifications } from './mobile-journeys.mjs';
import { mobileSafety } from './mobile-safety.mjs';
import { mobileGuestRides } from './mobile-guest-rides.mjs';
import { mobileVehicleChecks } from './mobile-vehicle-checks.mjs';
import { mobileTracking } from './mobile-tracking.mjs';
import { createMobileBooking } from './mobile-booking.mjs';
import { eatsRoutes } from '../modules/eats/routes.mjs';

/** Versioned native surface. Cookie identity and browser CSRF are never reused. */
export function createMobileRouter({ devices, accounts, drivers, rides, eats, locations, availability, chat, notifications, safety, safetyMonitoring, guestRides, vehicleChecks, payments, clock, rateLimiter, googleAuth, accountEmail }) {
  const monitorRoutes = safetyMonitoringRoutes(safetyMonitoring).filter(r=>!r.role);
  const foodRoutes = eatsRoutes(eats);
  const booking = createMobileBooking({ rides, locations, availability, clock });
  const journeys = createMobileJourneys({ rides, availability, chat, clock });
  function summary(ride) {
    return { id: ride.id, status: ride.status, pickup: ride.pickup.name, destination: ride.destination.name,
      fareKobo: ride.trip?.fareKobo ?? ride.negotiation?.agreement?.amountKobo ?? null,
      vehicleCategory: ride.vehicleCategory, passenger: ride.passenger, suggestedFareKobo: ride.suggestedFareKobo, createdAt: ride.createdAt, isDemo: ride.isDemo,
      driver: ride.driver ? { id: ride.driver.id, name: ride.driver.name, vehicle: ride.driver.vehicle } : null };
  }
  // An explicit owner-only projection keeps reviewer identities, hashes and audit internals off native clients.
  function onboarding(user, application) {
    return { driverId: application.driverId, status: application.status, version: application.version,
      details: application.details, busy: application.busy, eligibility: application.eligibility,
      reviewReason: application.reviewReason, vehicle: application.vehicle ?? user.driver.vehicle,
      documents: application.documents.map(({ id, kind, name, mimeType, sizeBytes, expiresOn }) =>
        ({ id, kind, name, mimeType, sizeBytes, expiresOn })) };
  }
  return async ({ request, response, pathname, clientAddress, origin }) => {
    check(['GET','POST'].includes(request.method), 'METHOD_NOT_ALLOWED', 'Use GET or POST.');
    check(!request.headers.origin && !request.headers['sec-fetch-site'], 'INVALID_ORIGIN', 'Use the native app for this endpoint.');
    const path = pathname.slice('/api/mobile/v1'.length), write = request.method === 'POST';
    const auth = (!write && ['/auth/providers','/auth/email-settings'].includes(path)) || (write && ['/auth/register','/auth/login','/auth/refresh','/auth/logout','/auth/google/challenge','/auth/google','/auth/password/request'].includes(path));
    const accessToken = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    let session = auth ? null : devices.sessionFor(accessToken);
    if (!auth) check(session, 'UNAUTHENTICATED', 'Sign in to continue.');
    const foodImage = !write && /^\/eats\/images\/[a-f0-9-]{36}$/.test(path);
    rateLimiter.consume(auth ? `auth:${clientAddress}` : foodImage ? `mobile-image:${session.user.id}` : `mobile:${session.user.id}`,
      clock(), auth ? 30 : foodImage ? 600 : 120, auth ? 10 * 60_000 : 60_000);
    let data;
    if (write) {
      data = await readBody(request, path === '/driver/application/upload' || /^\/eats\/stores\/[a-f0-9-]{36}\/(menu|photo)$/.test(path) || /^\/vehicle-checks\/rides\/[a-f0-9-]{36}$/.test(path) ? 2_800_000 : path === '/auth/google' ? 20_000 : 4096);
      if (!auth) { session = devices.sessionFor(accessToken); check(session, 'UNAUTHENTICATED', 'Sign in to continue.'); }
    }
    const query = new URL(request.url, origin).searchParams;
    let body;
    if (auth && path === '/auth/providers') body = { google: googleAuth.settings() };
    else if (auth && path === '/auth/email-settings') body = accountEmail.settings();
    else if (auth && path === '/auth/password/request') body = accountEmail.requestReset(data);
    else if (auth && path === '/auth/google/challenge') body = googleAuth.nativeChallenge(data);
    else if (auth && path === '/auth/google') body = await googleAuth.nativeLogin(data);
    else if (auth && path === '/auth/register') {
      fields(data, ['name', 'email', 'password', 'deviceName']);
      const user = await accounts.register({ name: data.name, email: data.email, password: data.password });
      body = devices.issue(user.id, data.deviceName);
    }
    else if (auth) body = path === '/auth/login' ? await devices.login(data) : path === '/auth/refresh' ? devices.refresh(data) : devices.logout(data);
    else if (!write && path === '/session') body = { user: session.user, sessionId: session.id };
    else if (!write && path === '/account/email') body = accountEmail.status(session.user.id);
    else if (path.startsWith('/eats/')) {
      const route = foodRoutes.find((entry) => entry.method === request.method && entry.path.test('/api' + path));
      check(route, 'NOT_FOUND', 'Eats endpoint not found.');
      const result = await route.handle({ user: session.user, query, data, key: request.headers['idempotency-key'], match: ('/api' + path).match(route.path), reauthenticate: () => { const fresh = devices.sessionFor(accessToken); check(fresh, 'UNAUTHENTICATED', 'Sign in to continue.'); return fresh.user; } });
      if (result.image) { response.writeHead(200, { 'Content-Type': result.image.mimeType, 'Content-Length': result.image.content.length }); response.end(result.image.content); return; }
      body = result.body;
    }
    else if (!write && /^\/payments\/rides\/[a-f0-9-]{36}$/.test(path)) body = payments.get(session.user.id, path.split('/')[3]);
    else if (!write && /^\/payments\/rides\/[a-f0-9-]{36}\/receipt$/.test(path)) body = payments.receipt(session.user.id, path.split('/')[3]);
    else if (write && /^\/payments\/rides\/[a-f0-9-]{36}\/start$/.test(path)) body = payments.command({ userId: session.user.id,
      rideId: path.split('/')[3], action: 'start', key: request.headers['idempotency-key'], data });
    else if (write && /^\/payments\/rides\/[a-f0-9-]{36}\/attempts\/[a-f0-9-]{36}\/simulate$/.test(path)) body = payments.command({ userId: session.user.id,
      rideId: path.split('/')[3], attemptId: path.split('/')[5], action: 'simulate', key: request.headers['idempotency-key'], data });
    else if (!write && path === '/driver/earnings') body = payments.earnings(session.user.id, query.get('before'));
    else if (write && path === '/account/email/request') body = accountEmail.requestVerification(session.user.id,data);
    else if (path === '/booking' || path.startsWith('/booking/')) body = await booking({ path, write, user: session.user,
      accessToken, data, key: request.headers['idempotency-key'] });
    else if (path === '/work' || path.startsWith('/work/') || path.startsWith('/journeys/')) body = journeys({ path, write, user: session.user,
      accessToken, query, data, key: request.headers['idempotency-key'] });
    else if (path.startsWith('/vehicle-checks/')) body = await mobileVehicleChecks({ vehicleChecks,session,path,write,data,key:request.headers['idempotency-key'] });
    else if (path.startsWith('/safety-monitoring/')) {
      const route=monitorRoutes.find(r=>r.method===request.method && r.path.test('/api'+path));
      check(route,'NOT_FOUND','Monitoring endpoint not found.');
      body=route.handle({user:session.user,nativeSessionId:session.id,match:('/api'+path).match(route.path),data,key:request.headers['idempotency-key']}).body;
    }
    else if (path.startsWith('/safety/')) body = mobileSafety({ safety, session, path, write, data, key: request.headers['idempotency-key'] });
    else if (path.startsWith('/guest-rides/')) body = mobileGuestRides({ guestRides, session, path, write, data, key: request.headers['idempotency-key'] });
    else if (path.startsWith('/tracking/')) body = mobileTracking({ locations, session, path, write, query, data, key: request.headers['idempotency-key'] });
    else if (path === '/notifications' || path.startsWith('/notifications/')) body = mobileNotifications({ notifications, user: session.user, sessionId: session.id, path, write, query, data });
    else if (!write && path === '/activity') {
      const mode = query.get('mode'); check(['customer','work'].includes(mode), 'INVALID_MODE', 'Choose Customer or Work.');
      const current = rides.list(session.user, mode), history = rides.history(session.user, query.get('before'), mode);
      body = { current: current.rides.filter((r) => !['completed','cancelled','expired'].includes(r.status)).map(summary), history: history.rides.map(summary),
        activeElsewhere: current.activeElsewhere, nextBefore: history.nextBefore };
    } else if (!write && path === '/driver/application') {
      check(hasCapability(session.user, 'driver'), 'FORBIDDEN', 'Add a driver profile first.');
      const application = drivers.get(session.user, session.user.id);
      body = { application: { status: application.status, eligibility: application.eligibility,
        documentCount: application.documents.length, vehicle: session.user.driver.vehicle } };
    } else if (!write && path === '/driver/onboarding') {
      check(hasCapability(session.user, 'driver'), 'FORBIDDEN', 'Add a driver profile first.');
      body = { application: onboarding(session.user, drivers.get(session.user, session.user.id)) };
    } else if (write && /^\/driver\/application\/(save|upload|remove|submit|reopen)$/.test(path)) {
      check(hasCapability(session.user, 'driver'), 'FORBIDDEN', 'Add a driver profile first.');
      const result = drivers.command(session.user, session.user.id, path.split('/').at(-1), data, request.headers['idempotency-key']);
      body = { application: onboarding(session.user, result.application), replayed: result.replayed };
    } else if (write && path === '/account/driver-profile') body = accounts.addDriverProfile(session.user.id, data, request.headers['idempotency-key']);
    else if (write && path === '/account/driver-profile/delete') body = accounts.deleteDriverProfile(session.user.id, data, request.headers['idempotency-key']);
    else if (!write && path === '/devices') body = { devices: devices.list(session.user, session.id) };
    else if (write && /^\/devices\/[a-f0-9-]{36}\/revoke$/.test(path)) {
      fields(data, []); body = devices.revoke(session.user, path.split('/')[2]);
    } else check(false, 'NOT_FOUND', 'Mobile API endpoint not found.');
    json(response, 200, { ...body, apiVersion: MOBILE_API_VERSION, serverNow: clock() });
  };
}
