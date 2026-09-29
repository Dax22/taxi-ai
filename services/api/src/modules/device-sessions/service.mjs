import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { hasCapability, requireRole } from '../../shared/policies.mjs';

export const ACCESS_MS = 10 * 60_000;
export const IDLE_MS = 7 * 24 * 60 * 60_000;
export const DEVICE_MS = 30 * 24 * 60 * 60_000;
const validToken = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Native sessions are separate from cookies and never authorize staff access. */
export function createDeviceSessionsService({ repository, authenticate, validatePasswordLogin, consumePasswordLogin = () => {}, getAccount, tokens, unitOfWork, audit, clock }) {
  const active = (s, now) => s && s.revokedAt === null && s.expiresAt > now && s.idleExpiresAt > now;
  function credentials(s, accessToken, refreshToken) {
    return { sessionId: s.id, accessToken, refreshToken, accessExpiresAt: s.accessExpiresAt,
      refreshExpiresAt: Math.min(s.expiresAt, s.idleExpiresAt) };
  }
  async function login(data) {
    fields(data, ['email', 'password', 'deviceName']);
    const name = label(data.deviceName, 'Device name', 2, 60);
    const authenticated = await authenticate({ email: data.email, password: data.password });
    return (await issue(authenticated.id, name, authenticated));
  }
  // Internal port called only after password or Google authentication succeeds.
  async function issue(userId, deviceName, passwordLogin = null) {
    const name = label(deviceName, 'Device name', 2, 60);
    const issued = (await unitOfWork(async () => {
      if (passwordLogin) { check(passwordLogin.id === userId, 'INVALID_CREDENTIALS', 'Sign in again.'); (await validatePasswordLogin(passwordLogin)); }
      const user = (await getAccount(userId)); requireRole(user, 'customer');
      const now = clock(); (await repository.purge(now));
      check((await repository.list(user.id)).filter((s) => active(s, now)).length < 5,
        'DEVICE_LIMIT', 'Five devices are already signed in. Sign out a device from your web account, then try again.');
      const accessToken = tokens.generate(), refreshToken = tokens.generate();
      const session = { id: tokens.id(), userId: user.id, name, accessHash: tokens.digest(accessToken),
        accessExpiresAt: now + ACCESS_MS, createdAt: now, expiresAt: now + DEVICE_MS, idleExpiresAt: now + IDLE_MS };
      (await repository.insert(session)); (await repository.insertRefresh(tokens.digest(refreshToken), session.id));
      (await audit.record(user.id, 'device.signed_in', session.id, now));
      return { user, credentials: credentials(session, accessToken, refreshToken) };
    }));
    if (passwordLogin) consumePasswordLogin(passwordLogin);
    return issued;
  }
  async function sessionFor(token) {
    if (!validToken(token)) return null;
    return (await sessionForHash(tokens.digest(token)));
  }
  async function sessionForHash(hash) {
    const now = clock(), s = (await repository.access(hash));
    if (!active(s, now) || s.accessExpiresAt <= now) return null;
    const user = (await getAccount(s.userId));
    return hasCapability(user, 'customer') ? { user, id: s.id } : null;
  }
  async function refresh(data) {
    fields(data, ['refreshToken']);
    check(validToken(data.refreshToken), 'UNAUTHENTICATED', 'Sign in again to continue.');
    // Replay revocation must COMMIT before reporting failure to the caller.
    const result = (await unitOfWork(async () => {
      const now = clock(), hash = tokens.digest(data.refreshToken), previous = (await repository.refresh(hash));
      const s = previous && (await repository.find(previous.sessionId));
      if (!active(s, now)) return null;
      if (previous.usedAt !== null) {
        (await repository.revoke(s.id, now)); (await audit.record(s.userId, 'device.refresh_reuse', s.id, now)); return null;
      }
      const user = (await getAccount(s.userId));
      if (!hasCapability(user, 'customer')) { (await repository.revoke(s.id, now)); return null; }
      const accessToken = tokens.generate(), refreshToken = tokens.generate();
      s.accessExpiresAt = Math.min(now + ACCESS_MS, s.expiresAt);
      s.idleExpiresAt = Math.min(now + IDLE_MS, s.expiresAt);
      (await repository.rotate(s.id, hash, tokens.digest(accessToken), s.accessExpiresAt, s.idleExpiresAt, now));
      (await repository.insertRefresh(tokens.digest(refreshToken), s.id));
      return { user, credentials: credentials(s, accessToken, refreshToken) };
    }));
    check(result, 'UNAUTHENTICATED', 'This device session ended. Sign in again.'); return result;
  }
  async function logout(data) {
    fields(data, ['refreshToken']);
    check(validToken(data.refreshToken), 'INVALID_TOKEN', 'A device refresh token is required.');
    (await unitOfWork(async () => {
      const previous = (await repository.refresh(tokens.digest(data.refreshToken)));
      const s = previous && (await repository.find(previous.sessionId));
      if (s && s.revokedAt === null) {
        (await repository.revoke(s.id, clock())); (await audit.record(s.userId, 'device.signed_out', s.id, clock()));
      }
    }));
    return { signedOut: true };
  }
  async function list(user, currentId = null) {
    requireRole(user, 'customer');
    return (await repository.list(user.id)).filter((s) => active(s, clock())).map((s) => ({ id: s.id, name: s.name,
      createdAt: s.createdAt, refreshedAt: s.refreshedAt, expiresAt: Math.min(s.expiresAt,s.idleExpiresAt), current: s.id === currentId }));
  }
  async function revoke(user, id) {
    return (await unitOfWork(async () => {
      requireRole((await getAccount(user.id)), 'customer');
      const s = (await repository.find(id));
      check(s?.userId === user.id, 'NOT_FOUND', 'Device session not found.');
      if (s.revokedAt === null) { (await repository.revoke(id, clock())); (await audit.record(user.id, 'device.revoked', id, clock())); }
      return { revoked: true };
    }));
  }
  return Object.freeze({ login, issue, sessionFor, refresh, logout, list, revoke,
    // Planning rechecks this internal port after provider I/O; it cannot authorize browser cookies.
    accessOwner: async (hash) => (await sessionForHash(hash))?.user.id ?? null,
    sessionOwner: async (id) => {
      const s = (await repository.find(id));
      return active(s, clock()) && hasCapability((await getAccount(s.userId)), 'customer') ? s.userId : null;
    },
    revokeUser: async (id) => (await repository.revokeUser(id, clock())), sweep: async () => (await unitOfWork(async () => (await repository.purge(clock())))) });
}
