/** This milestone accepts test credentials only; it cannot collect live funds. */
export function createPaystackConfig(env = {}, runtime = { mode: 'local', port: 3000 }) {
  const mode = env.TAXI_AI_PAYMENT_PROVIDER ?? 'off';
  if (!['off', 'paystack_test'].includes(mode)) throw new Error('TAXI_AI_PAYMENT_PROVIDER must be off or paystack_test. Live payments are not enabled.');
  const secretKey = env.PAYSTACK_SECRET_KEY ?? '';
  if (mode === 'off' && !secretKey) return Object.freeze({ enabled: false, configured: false, mode: 'test', secretKey: null, callbackUrl: null });
  if (!/^sk_test_[A-Za-z0-9]{20,128}$/.test(secretKey)) throw new Error('Paystack test checkout requires a valid sk_test_ PAYSTACK_SECRET_KEY. Live keys are refused.');
  const origin = runtime.publicOrigin ?? `http://localhost:${runtime.port ?? 3000}`;
  let url;
  try { url = new URL(origin); } catch { throw new Error('Paystack checkout needs a valid application origin.'); }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
    !(url.protocol === 'https:' || runtime.mode === 'local' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Paystack checkout requires the application HTTPS origin, or localhost in local development.');
  }
  return Object.freeze({ enabled: mode === 'paystack_test', configured: true, mode: 'test', secretKey, callbackUrl: `${url.origin}/payment-return` });
}
