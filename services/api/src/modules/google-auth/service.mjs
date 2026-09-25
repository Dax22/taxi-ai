import { check } from '../../shared/errors.mjs';
import { fields, label } from '../../shared/validation.mjs';
import { requireRole } from '../../shared/policies.mjs';

export const GOOGLE_ATTEMPT_MS = 10 * 60_000;
const validToken = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Provider-independent account ports; no HTTP, SDK, DB or frontend dependencies. */
export function createGoogleAuthService({ repository, provider, accounts, devices, tokens, unitOfWork, clock }) {
  const settings = () => ({ enabled: provider.config.enabled, nativeEnabled: provider.config.enabled && provider.config.nativeClientIds.length > 0 });
  function enabled(native = false) {
    check(native ? settings().nativeEnabled : settings().enabled, 'GOOGLE_DISABLED', 'Google sign-in is not available yet. Use email and password.');
  }
  async function save(attempt, previousBinding) {
    (await unitOfWork(async () => {
      (await repository.purge(clock()));
      if (validToken(previousBinding)) (await repository.replaceBinding(tokens.digest(previousBinding)));
      check((await repository.count()) < 2000, 'AUTH_BUSY', 'Please wait a moment before trying again.');
      (await repository.insert(attempt));
    }));
  }
  async function take(state, binding, channel, origin = null) {
    check(validToken(state) && validToken(binding), 'INVALID_GOOGLE_ATTEMPT', 'This Google sign-in expired. Start again.');
    const attempt = (await unitOfWork(async () => {
      const a = (await repository.find(tokens.digest(state)));
      if (!a || a.channel !== channel || a.expiresAt <= clock() || a.origin !== origin
        || !tokens.equal(a.bindingHash, tokens.digest(binding))) return null;
      (await repository.remove(a.stateHash)); return a;
    }));
    check(attempt, 'INVALID_GOOGLE_ATTEMPT', 'This Google sign-in expired or was already used. Start again.');
    return attempt;
  }
  async function startWeb({ data, token, origin, previousBinding, link = false }) {
    enabled(); fields(data, link ? ['password'] : []);
    check(origin === provider.config.origin, 'INVALID_ORIGIN', 'Use the configured Taxi Ai address for Google sign-in.');
    const session = (await accounts.sessionFor(token));
    let actorId = null, sessionHash = null;
    if (link) {
      requireRole(session?.user, 'customer');
      const user = await accounts.login({ email: session.user.email, password: data.password });
      check(user.id === session.user.id && (await accounts.sessionFor(token))?.user.id === user.id,
        'UNAUTHENTICATED', 'Your session changed. Sign in again.');
      requireRole(user, 'customer'); actorId = user.id; sessionHash = tokens.digest(token);
    } else check(!session, 'GOOGLE_SESSION_CHANGED', 'Sign out before switching accounts, or connect Google from Sign-in methods.');
    const state = tokens.generate(), binding = tokens.generate(), nonce = tokens.generate(), verifier = tokens.generate();
    const redirectUrl = provider.authorization({ state, nonce, verifier });
    (await save({ stateHash: tokens.digest(state), bindingHash: tokens.digest(binding), nonce, verifier,
      channel: 'web', intent: link ? 'link' : 'login', origin, actorId, sessionHash, expiresAt: clock() + GOOGLE_ATTEMPT_MS }, previousBinding));
    return { binding, redirectUrl };
  }
  async function finishWeb({ state, binding, code, error, origin }) {
    enabled(); const a = (await take(state, binding, 'web', origin));
    check(!error, 'GOOGLE_CANCELLED', 'Google sign-in was cancelled. You can try again.');
    check(typeof code === 'string' && code.length > 0 && code.length <= 4096 && !/[\u0000-\u0020]/.test(code),
      'INVALID_GOOGLE_ATTEMPT', 'Google did not return a valid sign-in code.');
    const identity = await provider.exchange(code, a.nonce, a.verifier);
    return unitOfWork(async () => {
      check(a.expiresAt > clock(), 'INVALID_GOOGLE_ATTEMPT', 'This Google sign-in expired. Start again.');
      if (a.intent === 'link') check((await accounts.sessionOwner(a.sessionHash)) === a.actorId, 'UNAUTHENTICATED', 'Your session ended. Sign in and connect Google again.');
      const user = (await accounts.resolveGoogle(identity, a.actorId));
      return { user, linked: a.intent === 'link' };
    });
  }
  async function nativeChallenge(data) {
    enabled(true); fields(data, []);
    const challenge = tokens.generate(), nonce = tokens.generate();
    (await save({ stateHash: tokens.digest(challenge), bindingHash: tokens.digest(challenge), nonce,
      channel: 'native', intent: 'login', expiresAt: clock() + GOOGLE_ATTEMPT_MS }));
    return { challenge, nonce, webClientId: provider.config.clientId };
  }
  async function nativeLogin(data) {
    enabled(true); fields(data, ['challenge', 'idToken', 'deviceName']);
    const deviceName = label(data.deviceName, 'Device name', 2, 60);
    const a = (await take(data.challenge, data.challenge, 'native'));
    const identity = await provider.verifyNative(data.idToken, a.nonce);
    check(a.expiresAt > clock(), 'INVALID_GOOGLE_ATTEMPT', 'This Google sign-in expired. Start again.');
    const user = (await accounts.resolveGoogle(identity));
    return (await devices.issue(user.id, deviceName));
  }
  return Object.freeze({ settings, startWeb, finishWeb, nativeChallenge, nativeLogin,
    sweep: async () => (await unitOfWork(async () => (await repository.purge(clock())))) });
}
