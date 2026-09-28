import { timingSafeEqual, createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { check } from '../shared/errors.mjs';

const COOKIE = 'taxi_ai_session';
const HOST_COOKIE = '__Host-taxi_ai_session';
const digest = (value) => createHash('sha256').update(value).digest();

export function requestContext(request, runtime) {
  if (runtime.mode === 'local') return { origin: localOrigin(request), clientAddress: request.socket.remoteAddress };
  const origin = new URL(runtime.publicOrigin), token = request.headers['x-taxi-ai-proxy-token'];
  check(request.headers.host?.toLowerCase() === origin.host, 'INVALID_HOST', 'Use the configured Taxi Ai address.');
  check(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)
    && timingSafeEqual(digest(token), digest(runtime.proxyToken)), 'INVALID_PROXY', 'Use the Taxi Ai HTTPS gateway.');
  check(request.headers['x-forwarded-proto'] === 'https', 'INVALID_PROXY', 'An HTTPS gateway connection is required.');
  const clientAddress = request.headers['x-forwarded-for'];
  check(typeof clientAddress === 'string' && isIP(clientAddress), 'INVALID_PROXY', 'The gateway must provide one client address.');
  return { origin: runtime.publicOrigin, clientAddress };
}

export function requireStagingAccess(request, response, runtime, pathname = '') {
  if (runtime.mode !== 'staging') return;
  const header = pathname.startsWith('/api/mobile/v1/') ? request.headers['x-taxi-ai-preview-access'] : request.headers.authorization;
  let name = '', token = '';
  if (typeof header === 'string' && header.length <= 256 && /^Basic [A-Za-z0-9+/]+=*$/i.test(header)) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const match = decoded.match(/^([a-z0-9_-]{3,40}):([a-f0-9]{64})$/);
    if (match) [, name, token] = match;
  }
  const expected = runtime.testers.get(name);
  const matches = timingSafeEqual(digest(token), Buffer.from(expected ?? '0'.repeat(64), 'hex'));
  if (!expected || !matches) {
    response.setHeader('WWW-Authenticate', 'Basic realm="Taxi Ai private preview", charset="UTF-8"');
    check(false, 'STAGING_ACCESS_REQUIRED', 'An invited tester access key is required.');
  }
}

export function isInternalHealth(request, pathname) {
  return ['/health/live', '/health/ready'].includes(pathname) && ['GET', 'HEAD'].includes(request.method)
    && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)
    && [`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`].includes(request.headers.host);
}

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

export function readSessionToken(cookieHeader = '', secure = false) {
  const name = secure ? HOST_COOKIE : COOKIE;
  const raw = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  return typeof raw === 'string' && /^[a-f0-9]{64}$/.test(raw) ? raw : null;
}

export function sessionCookie(token, maxAgeSeconds, secure = false) {
  return `${secure ? HOST_COOKIE : COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

export function requireCsrf(request, session) {
  const token = request.headers['x-csrf-token'];
  check(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)
    && timingSafeEqual(Buffer.from(token), Buffer.from(session.csrfToken)),
  'INVALID_CSRF', 'Refresh the page before trying again.');
}
