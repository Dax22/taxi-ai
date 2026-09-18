import { ApiError, check } from './errors.mjs';
import { register, login, sessionFor, issueSession, revokeSession, sessionCookie, requireCsrf, rateLimit } from './auth.mjs';
import { listRides, getRide, mutateRide, listDrivers, reviewDriver } from './rides.mjs';

export function localOrigin(request) {
  const port = request.socket.localPort;
  const host = request.headers.host;
  check(host === `localhost:${port}` || host === `127.0.0.1:${port}`,
    403, 'INVALID_HOST', 'Open Taxi Ai using its localhost address.');
  return `http://${host}`;
}

export function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
  response.end(payload);
}

async function readBody(request) {
  check(/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type'] ?? ''),
    415, 'JSON_REQUIRED', 'Use application/json.');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes <= 16_384) chunks.push(chunk);
  }
  check(bytes <= 16_384, 413, 'BODY_TOO_LARGE', 'The request is too large.');
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'INVALID_JSON', 'Send valid JSON.'); }
}

export async function handleApi({ request, response, pathname, db, clock }) {
  const origin = localOrigin(request);
  const now = clock();
  const write = request.method === 'POST';
  check(['GET', 'POST'].includes(request.method), 405, 'METHOD_NOT_ALLOWED', 'Use GET or POST.');
  check((!write && !request.headers.origin) || request.headers.origin === origin,
    403, 'INVALID_ORIGIN', 'Open this page directly from Taxi Ai before trying again.');
  check(request.headers['sec-fetch-site'] !== 'cross-site', 403, 'INVALID_ORIGIN', 'Cross-site requests are not allowed.');

  if (write && ['/api/auth/register', '/api/auth/login'].includes(pathname)) {
    rateLimit(db, `auth:${request.socket.remoteAddress}`, now, 30, 10 * 60_000);
    const data = await readBody(request);
    const user = pathname.endsWith('/register') ? await register(db, data, clock()) : await login(db, data);
    const session = issueSession(db, request, user.id, clock());
    response.setHeader('Set-Cookie', session.cookie);
    json(response, pathname.endsWith('/register') ? 201 : 200, { user, csrfToken: session.csrfToken, serverNow: clock() });
    return;
  }

  const session = sessionFor(db, request, now);
  if (request.method === 'GET' && pathname === '/api/session') {
    json(response, 200, { user: session?.user ?? null, csrfToken: session?.csrfToken ?? null, serverNow: now });
    return;
  }
  check(session, 401, 'UNAUTHENTICATED', 'Sign in to continue.');
  const { user } = session;
  let data;
  if (write) {
    requireCsrf(request, session);
    rateLimit(db, `write:${user.id}`, now, 60, 60_000);
    data = await readBody(request);
  }
  if (write && pathname === '/api/auth/logout') {
    revokeSession(db, request);
    response.setHeader('Set-Cookie', sessionCookie('', 0));
    json(response, 200, { ok: true });
    return;
  }
  if (request.method === 'GET' && pathname === '/api/rides') {
    json(response, 200, { ...listRides(db, user), serverNow: now });
    return;
  }
  if (request.method === 'GET' && pathname === '/api/admin/drivers') {
    json(response, 200, { drivers: listDrivers(db, user), serverNow: now });
    return;
  }
  const review = pathname.match(/^\/api\/admin\/drivers\/([a-f0-9-]{36})\/review$/);
  if (write && review) {
    json(response, 200, { driver: reviewDriver(db, user, review[1], data, clock()) });
    return;
  }
  const rideMatch = pathname.match(/^\/api\/rides\/([a-f0-9-]{36})(?:\/(claim|offers|accept|cancel))?$/);
  if (request.method === 'GET' && rideMatch && !rideMatch[2]) {
    json(response, 200, { ride: getRide(db, user, rideMatch[1]), serverNow: now });
    return;
  }
  if (write && (pathname === '/api/rides' || rideMatch?.[2])) {
    const action = pathname === '/api/rides' ? 'create' : rideMatch[2] === 'offers' ? 'propose' : rideMatch[2];
    const result = mutateRide(db, { userId: user.id, key: request.headers['idempotency-key'],
      action, id: rideMatch?.[1] ?? null, data, now: clock() });
    json(response, action === 'create' && !result.replayed ? 201 : 200, { ...result, serverNow: clock() });
    return;
  }
  throw new ApiError(404, 'NOT_FOUND', 'API endpoint not found.');
}
