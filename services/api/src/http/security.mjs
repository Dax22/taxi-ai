import { timingSafeEqual } from 'node:crypto';
import { check } from '../shared/errors.mjs';

const COOKIE = 'taxi_ai_session';

export function localOrigin(request) {
  const port = request.socket.localPort;
  const host = request.headers.host;
  check(host === `localhost:${port}` || host === `127.0.0.1:${port}`,
    'INVALID_HOST', 'Open Taxi Ai using its localhost address.');
  return `http://${host}`;
}

export function requireSameOrigin(request, origin, write) {
  check((!write && !request.headers.origin) || request.headers.origin === origin,
    'INVALID_ORIGIN', 'Open this page directly from Taxi Ai before trying again.');
  check(request.headers['sec-fetch-site'] !== 'cross-site', 'INVALID_ORIGIN', 'Cross-site requests are not allowed.');
}

export function readSessionToken(cookieHeader = '') {
  const raw = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  return typeof raw === 'string' && /^[a-f0-9]{64}$/.test(raw) ? raw : null;
}

export function sessionCookie(token, maxAgeSeconds) {
  // HTTP is intentional on loopback. Public hosting requires HTTPS + Secure.
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function requireCsrf(request, session) {
  const token = request.headers['x-csrf-token'];
  check(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)
    && timingSafeEqual(Buffer.from(token), Buffer.from(session.csrfToken)),
  'INVALID_CSRF', 'Refresh the page before trying again.');
}
