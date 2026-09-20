import { OAuth2Client } from 'google-auth-library';
import { createHash } from 'node:crypto';
import { check, ApplicationError } from '../shared/errors.mjs';

/** All Google networking and cryptographic verification stay in this adapter. */
export function createGoogleProvider({ config, clock = Date.now, client = new OAuth2Client({
  clientId: config.clientId, clientSecret: config.clientSecret, redirectUri: config.redirectUri,
  transporterOptions: { timeout: 4000, retry: false, maxRedirects: 0 },
}) }) {
  // SDK methods supply retry defaults of their own. Enforce our final network
  // budget through its supported interceptor, including one-time code exchange.
  client.transporter.interceptors.request.add({ resolved: (options) => ({ ...options, retry: false, retryConfig: { retry: 0, noResponseRetries: 0 },
    maxRedirects: 0, follow: 0, redirect: 'error',
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
  }) });
  let pending = 0;
  async function bounded(run) {
    check(pending < 8, 'AUTH_BUSY', 'Please wait a moment before trying again.');
    pending++;
    try { return await run(); }
    catch (error) {
      if (error instanceof ApplicationError) throw error;
      // Never return SDK errors: they can contain codes, tokens or client secrets.
      throw new ApplicationError('GOOGLE_UNAVAILABLE', 'Google sign-in could not finish. Please try again.');
    } finally { pending--; }
  }
  async function verify(idToken, nonce, native = false) {
    check(typeof idToken === 'string' && idToken.length <= 16_384, 'INVALID_GOOGLE_IDENTITY', 'Google identity could not be verified.');
    let header;
    try { header = JSON.parse(Buffer.from(idToken.split('.')[0], 'base64url').toString('utf8')); } catch { /* Rejected below. */ }
    check(header?.alg === 'RS256' && typeof header.kid === 'string', 'INVALID_GOOGLE_IDENTITY', 'Google identity could not be verified.');
    const ticket = await client.verifyIdToken({ idToken, audience: config.clientId, maxExpiry: 7200 });
    const p = ticket.getPayload(), now = clock() / 1000;
    check(p && ['accounts.google.com', 'https://accounts.google.com'].includes(p.iss) && p.aud === config.clientId
      && (!p.azp || [config.clientId, ...(native ? config.nativeClientIds : [])].includes(p.azp))
      && Number.isFinite(p.exp) && p.exp > now && Number.isFinite(p.iat) && p.iat <= now + 60
      && p.exp > p.iat && p.exp - p.iat <= 7200 && p.nonce === nonce && p.email_verified === true
      && typeof p.sub === 'string' && /^[\x21-\x7e]{1,255}$/.test(p.sub)
      && typeof p.email === 'string', 'INVALID_GOOGLE_IDENTITY', 'Google identity could not be verified. Please start again.');
    return { subject: p.sub, email: p.email, name: p.name ?? p.given_name ?? 'Taxi Ai member' };
  }
  return Object.freeze({ config,
    authorization({ state, nonce, verifier }) {
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      return client.generateAuthUrl({ response_type: 'code', scope: ['openid', 'email', 'profile'],
        access_type: 'online', prompt: 'select_account', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' });
    },
    exchange: (code, nonce, verifier) => bounded(async () => {
      const result = await client.getToken({ code, codeVerifier: verifier, redirect_uri: config.redirectUri });
      // Google access/refresh tokens are never retained or returned to clients.
      return verify(result.tokens.id_token, nonce);
    }),
    verifyNative: (idToken, nonce) => bounded(() => verify(idToken, nonce, true)),
  });
}
