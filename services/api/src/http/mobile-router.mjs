import { MOBILE_API_VERSION } from '../../../../packages/shared/src/mobile-contracts.mjs';
import { check } from '../shared/errors.mjs';
import { fields } from '../shared/validation.mjs';
import { hasCapability } from '../shared/policies.mjs';
import { readBody } from './body.mjs';
import { json } from './responses.mjs';
import { createMobileJourneys, mobileNotifications } from './mobile-journeys.mjs';
import { createMobileBooking } from './mobile-booking.mjs';

/** Versioned native surface. Cookie identity and browser CSRF are never reused. */
export function createMobileRouter({ devices, accounts, drivers, rides, locations, availability, chat, notifications, clock, rateLimiter, googleAuth, accountEmail }) {
  const booking = createMobileBooking({ rides, locations, availability, clock });
  const journeys = createMobileJourneys({ rides, availability, chat, clock });
  function summary(ride) {
    return { id: ride.id, status: ride.status, pickup: ride.pickup.name, destination: ride.destination.name,
      fareKobo: ride.trip?.fareKobo ?? ride.negotiation?.agreement?.amountKobo ?? null,
      vehicleCategory: ride.vehicleCategory, suggestedFareKobo: ride.suggestedFareKobo, createdAt: ride.createdAt, isDemo: ride.isDemo,
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
    const auth = (!write && ['/auth/providers','/auth/email-settings'].includes(path)) || (write && ['/auth/login','/auth/refresh','/auth/logout','/auth/google/challenge','/auth/google','/auth/password/request'].includes(path));
    const accessToken = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    let session = auth ? null : devices.sessionFor(accessToken);
    if (!auth) check(session, 'UNAUTHENTICATED', 'Sign in to continue.');
    rateLimiter.consume(auth ? `auth:${clientAddress}` : `mobile:${session.user.id}`, clock(), auth ? 30 : 120, auth ? 10 * 60_000 : 60_000);
    let data;
    if (write) {
      data = await readBody(request, path === '/driver/application/upload' ? 2_800_000 : path === '/auth/google' ? 20_000 : 4096);
      if (!auth) { session = devices.sessionFor(accessToken); check(session, 'UNAUTHENTICATED', 'Sign in to continue.'); }
    }
    const query = new URL(request.url, origin).searchParams;
    let body;
    if (auth && path === '/auth/providers') body = { google: googleAuth.settings() };
    else if (auth && path === '/auth/email-settings') body = accountEmail.settings();
    else if (auth && path === '/auth/password/request') body = accountEmail.requestReset(data);
    else if (auth && path === '/auth/google/challenge') body = googleAuth.nativeChallenge(data);
    else if (auth && path === '/auth/google') body = await googleAuth.nativeLogin(data);
    else if (auth) body = path === '/auth/login' ? await devices.login(data) : path === '/auth/refresh' ? devices.refresh(data) : devices.logout(data);
    else if (!write && path === '/session') body = { user: session.user, sessionId: session.id };
    else if (!write && path === '/account/email') body = accountEmail.status(session.user.id);
    else if (write && path === '/account/email/request') body = accountEmail.requestVerification(session.user.id,data);
    else if (path === '/booking' || path.startsWith('/booking/')) body = await booking({ path, write, user: session.user,
      accessToken, data, key: request.headers['idempotency-key'] });
    else if (path === '/work' || path.startsWith('/work/') || path.startsWith('/journeys/')) body = journeys({ path, write, user: session.user,
      accessToken, query, data, key: request.headers['idempotency-key'] });
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
    else if (!write && path === '/devices') body = { devices: devices.list(session.user, session.id) };
    else if (write && /^\/devices\/[a-f0-9-]{36}\/revoke$/.test(path)) {
      fields(data, []); body = devices.revoke(session.user, path.split('/')[2]);
    } else check(false, 'NOT_FOUND', 'Mobile API endpoint not found.');
    json(response, 200, { ...body, apiVersion: MOBILE_API_VERSION, serverNow: clock() });
  };
}
