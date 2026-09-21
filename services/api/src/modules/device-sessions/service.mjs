import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { hasCapability, requireRole } from '../../shared/policies.mjs';

export const ACCESS_MS = 10 * 60_000;
export const IDLE_MS = 7 * 24 * 60 * 60_000;
export const DEVICE_MS = 30 * 24 * 60 * 60_000;
const validToken = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Native sessions are separate from cookies and never authorize staff access. */
export function createDeviceSessionsService({ repository, authenticate, validatePasswordLogin, getAccount, tokens, unitOfWork, audit, clock }) {
  const active = (s, now) => s && s.revokedAt === null && s.expiresAt > now && s.idleExpiresAt > now;
  function credentials(s, accessToken, refreshToken) {
    return { sessionId: s.id, accessToken, refreshToken, accessExpiresAt: s.accessExpiresAt,
      refreshExpiresAt: Math.min(s.expiresAt, s.idleExpiresAt) };
  }
  async function login(data) {
    fields(data, ['email', 'password', 'deviceName']);
    const name = label(data.deviceName, 'Device name', 2, 60);
    const authenticated = await authenticate({ email: data.email, password: data.password });
    return issue(authenticated.id, name, authenticated);
  }
  // Internal port called only after password or Google authentication succeeds.
  function issue(userId, deviceName, passwordLogin = null) {
    const name = label(deviceName, 'Device name', 2, 60);
    return unitOfWork(() => {
      if (passwordLogin) { check(passwordLogin.id === userId, 'INVALID_CREDENTIALS', 'Sign in again.'); validatePasswordLogin(passwordLogin); }
      const user = getAccount(userId); requireRole(user, 'customer');
      const now = clock(); repository.purge(now);
      check(repository.list(user.id).filter((s) => active(s, now)).length < 5,
        'DEVICE_LIMIT', 'Five devices are already signed in. Sign out a device from your web account, then try again.');
      const accessToken = tokens.generate(), refreshToken = tokens.generate();
      const session = { id: tokens.id(), userId: user.id, name, accessHash: tokens.digest(accessToken),
        accessExpiresAt: now + ACCESS_MS, createdAt: now, expiresAt: now + DEVICE_MS, idleExpiresAt: now + IDLE_MS };
      repository.insert(session); repository.insertRefresh(tokens.digest(refreshToken), session.id);
      audit.record(user.id, 'device.signed_in', session.id, now);
      return { user, credentials: credentials(session, accessToken, refreshToken) };
    });
  }
  function sessionFor(token) {
    if (!validToken(token)) return null;
    const now = clock(), s = repository.access(tokens.digest(token));
    if (!active(s, now) || s.accessExpiresAt <= now) return null;
    const user = getAccount(s.userId);
    return hasCapability(user, 'customer') ? { user, id: s.id } : null;
  }
  function refresh(data) {
    fields(data, ['refreshToken']);
    check(validToken(data.refreshToken), 'UNAUTHENTICATED', 'Sign in again to continue.');
    // Replay revocation must COMMIT before reporting failure to the caller.
    const result = unitOfWork(() => {
      const now = clock(), hash = tokens.digest(data.refreshToken), previous = repository.refresh(hash);
      const s = previous && repository.find(previous.sessionId);
      if (!active(s, now)) return null;
      if (previous.usedAt !== null) {
        repository.revoke(s.id, now); audit.record(s.userId, 'device.refresh_reuse', s.id, now); return null;
      }
      const user = getAccount(s.userId);
      if (!hasCapability(user, 'customer')) { repository.revoke(s.id, now); return null; }
      const accessToken = tokens.generate(), refreshToken = tokens.generate();
      s.accessExpiresAt = Math.min(now + ACCESS_MS, s.expiresAt);
      s.idleExpiresAt = Math.min(now + IDLE_MS, s.expiresAt);
      repository.rotate(s.id, hash, tokens.digest(accessToken), s.accessExpiresAt, s.idleExpiresAt, now);
      repository.insertRefresh(tokens.digest(refreshToken), s.id);
      return { user, credentials: credentials(s, accessToken, refreshToken) };
    });
    check(result, 'UNAUTHENTICATED', 'This device session ended. Sign in again.'); return result;
  }
  function logout(data) {
    fields(data, ['refreshToken']);
    check(validToken(data.refreshToken), 'INVALID_TOKEN', 'A device refresh token is required.');
    unitOfWork(() => {
      const previous = repository.refresh(tokens.digest(data.refreshToken));
      const s = previous && repository.find(previous.sessionId);
      if (s && s.revokedAt === null) {
        repository.revoke(s.id, clock()); audit.record(s.userId, 'device.signed_out', s.id, clock());
      }
    });
    return { signedOut: true };
  }
  function list(user, currentId = null) {
    requireRole(user, 'customer');
    return repository.list(user.id).filter((s) => active(s, clock())).map((s) => ({ id: s.id, name: s.name,
      createdAt: s.createdAt, refreshedAt: s.refreshedAt, expiresAt: Math.min(s.expiresAt,s.idleExpiresAt), current: s.id === currentId }));
  }
  function revoke(user, id) {
    return unitOfWork(() => {
      requireRole(getAccount(user.id), 'customer');
      const s = repository.find(id);
      check(s?.userId === user.id, 'NOT_FOUND', 'Device session not found.');
      if (s.revokedAt === null) { repository.revoke(id, clock()); audit.record(user.id, 'device.revoked', id, clock()); }
      return { revoked: true };
    });
  }
  return Object.freeze({ login, issue, sessionFor, refresh, logout, list, revoke,
    revokeUser: (id) => repository.revokeUser(id, clock()), sweep: () => unitOfWork(() => repository.purge(clock())) });
}
