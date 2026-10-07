/** Paystack is off by default. Live collection requires an explicit second gate. */
export function createPaystackConfig(env = {}, runtime = { mode: 'local', port: 3000 }) {
  const provider = env.TAXI_AI_PAYMENT_PROVIDER ?? 'off';
  if (!['off', 'paystack_test', 'paystack_live'].includes(provider)) throw new Error('TAXI_AI_PAYMENT_PROVIDER must be off, paystack_test or paystack_live.');
  const secretKey = env.PAYSTACK_SECRET_KEY ?? '';
  const keyMode = /^sk_test_[A-Za-z0-9]{20,128}$/.test(secretKey) ? 'test' : /^sk_live_[A-Za-z0-9]{20,128}$/.test(secretKey) ? 'live' : null;
  if (provider === 'off' && !secretKey) return Object.freeze({ enabled: false, configured: false, mode: 'test', secretKey: null, callbackUrl: null, wallets: ['apple_pay','google_pay'] });
  if (!keyMode) throw new Error('Paystack requires a valid test or live secret key.');
  if (provider === 'paystack_test' && keyMode !== 'test') throw new Error('paystack_test requires an sk_test_ key.');
  if (provider === 'paystack_live') {
    if (keyMode !== 'live') throw new Error('paystack_live requires an sk_live_ key.');
    if (env.TAXI_AI_PAYSTACK_LIVE_ENABLED !== 'true') throw new Error('Live Paystack requires TAXI_AI_PAYSTACK_LIVE_ENABLED=true as an explicit deployment gate.');
  }
  const origin = runtime.publicOrigin ?? `http://localhost:${runtime.port ?? 3000}`;
  let url;
  try { url = new URL(origin); } catch { throw new Error('Paystack checkout needs a valid application origin.'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    !(url.protocol === 'https:' || runtime.mode === 'local' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Paystack checkout requires the application HTTPS origin, or localhost in local development.');
  }
  const enabled = provider === `paystack_${keyMode}`;
  return Object.freeze({ enabled, configured: true, mode: keyMode, secretKey, callbackUrl: `${url.origin}/payment-return`, wallets: ['apple_pay','google_pay'] });
}
