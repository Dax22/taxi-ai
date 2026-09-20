import { MOBILE_API_VERSION } from '../../../../packages/shared/src/mobile-contracts.mjs';
import { check } from '../shared/errors.mjs';
import { fields } from '../shared/validation.mjs';
import { hasCapability } from '../shared/policies.mjs';
import { readBody } from './body.mjs';
import { json } from './responses.mjs';

/** Versioned native surface. Cookie identity and browser CSRF are never reused. */
export function createMobileRouter({ devices, accounts, drivers, rides, clock, rateLimiter }) {
  function summary(ride) {
    return { id: ride.id, status: ride.status, pickup: ride.pickup.name, destination: ride.destination.name,
      fareKobo: ride.trip?.fareKobo ?? ride.negotiation?.agreement?.amountKobo ?? null,
      suggestedFareKobo: ride.suggestedFareKobo, createdAt: ride.createdAt, isDemo: ride.isDemo };
  }
  return async ({ request, response, pathname, clientAddress, origin }) => {
    check(['GET','POST'].includes(request.method), 'METHOD_NOT_ALLOWED', 'Use GET or POST.');
    check(!request.headers.origin && !request.headers['sec-fetch-site'], 'INVALID_ORIGIN', 'Use the native app for this endpoint.');
    const path = pathname.slice('/api/mobile/v1'.length), write = request.method === 'POST';
    const auth = write && ['/auth/login','/auth/refresh','/auth/logout'].includes(path);
    const accessToken = request.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    let session = auth ? null : devices.sessionFor(accessToken);
    if (!auth) check(session, 'UNAUTHENTICATED', 'Sign in to continue.');
    rateLimiter.consume(auth ? `auth:${clientAddress}` : `mobile:${session.user.id}`, clock(), auth ? 30 : 120, auth ? 10 * 60_000 : 60_000);
    let data;
    if (write) {
      data = await readBody(request, 4096);
      if (!auth) { session = devices.sessionFor(accessToken); check(session, 'UNAUTHENTICATED', 'Sign in to continue.'); }
    }
    const query = new URL(request.url, origin).searchParams;
    let body;
    if (auth) body = path === '/auth/login' ? await devices.login(data) : path === '/auth/refresh' ? devices.refresh(data) : devices.logout(data);
    else if (!write && path === '/session') body = { user: session.user, sessionId: session.id };
    else if (!write && path === '/activity') {
      const mode = query.get('mode'); check(['customer','work'].includes(mode), 'INVALID_MODE', 'Choose Customer or Work.');
      const current = rides.list(session.user, mode), history = rides.history(session.user, query.get('before'), mode);
      body = { current: current.rides.map(summary), history: history.rides.map(summary),
        activeElsewhere: current.activeElsewhere, nextBefore: history.nextBefore };
    } else if (!write && path === '/driver/application') {
      check(hasCapability(session.user, 'driver'), 'FORBIDDEN', 'Add a driver profile first.');
      const application = drivers.get(session.user, session.user.id);
      body = { application: { status: application.status, eligibility: application.eligibility,
        documentCount: application.documents.length, vehicle: session.user.driver.vehicle } };
    } else if (write && path === '/account/driver-profile') body = accounts.addDriverProfile(session.user.id, data, request.headers['idempotency-key']);
    else if (!write && path === '/devices') body = { devices: devices.list(session.user, session.id) };
    else if (write && /^\/devices\/[a-f0-9-]{36}\/revoke$/.test(path)) {
      fields(data, []); body = devices.revoke(session.user, path.split('/')[2]);
    } else check(false, 'NOT_FOUND', 'Mobile API endpoint not found.');
    json(response, 200, { ...body, apiVersion: MOBILE_API_VERSION, serverNow: clock() });
  };
}
