const clientId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value);

/** Optional provider configuration. A partially configured provider fails closed. */
export function createGoogleConfig(env = {}, runtime = { mode: 'local', port: 3000 }) {
  const id = env.TAXI_AI_GOOGLE_CLIENT_ID, secret = env.TAXI_AI_GOOGLE_CLIENT_SECRET;
  const redirect = env.TAXI_AI_GOOGLE_REDIRECT_URI, native = env.TAXI_AI_GOOGLE_NATIVE_CLIENT_IDS;
  if (![id, secret, redirect, native].some(Boolean)) return Object.freeze({ enabled: false, nativeClientIds: [] });
  if (!clientId(id) || typeof secret !== 'string' || secret.length < 8 || secret.length > 256 || /\s/.test(secret)) {
    throw new Error('Google sign-in needs a valid TAXI_AI_GOOGLE_CLIENT_ID and server-only TAXI_AI_GOOGLE_CLIENT_SECRET.');
  }
  let url;
  try { url = new URL(redirect); } catch { throw new Error('Set TAXI_AI_GOOGLE_REDIRECT_URI to the exact Google callback URL.'); }
  const origin = runtime.mode === 'staging' ? runtime.publicOrigin : `http://localhost:${runtime.port}`;
  if (url.origin !== origin || url.pathname !== '/auth/google/callback' || url.username || url.password || url.search || url.hash) {
    throw new Error('Google redirect must be the configured Taxi Ai origin followed by /auth/google/callback. Use localhost for local Google sign-in.');
  }
  const nativeClientIds = native ? native.split(',').map((value) => value.trim()) : [];
  if (nativeClientIds.length > 10 || nativeClientIds.some((value) => !clientId(value))) throw new Error('Use comma-separated Google iOS/Android OAuth client IDs in TAXI_AI_GOOGLE_NATIVE_CLIENT_IDS.');
  return Object.freeze({ enabled: true, clientId: id, clientSecret: secret, redirectUri: url.href, origin,
    nativeClientIds: Object.freeze([...new Set(nativeClientIds)]) });
}
