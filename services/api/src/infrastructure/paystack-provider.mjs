import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApplicationError, check } from '../shared/errors.mjs';

const REFERENCE = /^[A-Za-z0-9_.=-]{1,128}$/;
const STATUSES = new Set(['success', 'failed', 'abandoned', 'pending', 'ongoing', 'processing', 'queued', 'reversed']);
const unavailable = () => new ApplicationError('PAYSTACK_UNAVAILABLE', 'Payment confirmation is temporarily unavailable. Check this payment again; do not create another charge.');

/** Fixed upstream, bounded responses/timeouts and no automatic initialize retries. */
export function createPaystackProvider({ config, fetchImpl = fetch, timeoutMs = 8000 }) {
  let active = 0;
  const enabled = config.enabled === true, configured = config.configured === true;
  async function request(path, method = 'GET', body) {
    check(configured, 'PAYMENTS_DISABLED', 'Paystack checkout is not configured.');
    check(active < 8, 'PAYSTACK_BUSY', 'Payment requests are busy. Check again shortly.');
    active++;
    try {
      const response = await fetchImpl(`https://api.paystack.co${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { Authorization: `Bearer ${config.secretKey}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      // Do not echo upstream messages, headers, customer objects or raw responses.
      if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 65_536) { await response.body?.cancel(); throw unavailable(); }
      const reader = response.body?.getReader();
      if (!reader) throw unavailable();
      const chunks = []; let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.byteLength;
          if (length > 65_536) { await reader.cancel(); throw unavailable(); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (result?.status !== true || !result.data || typeof result.data !== 'object') throw unavailable();
      return result.data;
    } catch { throw unavailable(); }
    finally { active--; }
  }
  async function initialize({ email, amountKobo, reference }) {
    check(enabled, 'PAYMENTS_DISABLED', 'New Paystack checkouts are disabled.');
    check(typeof email === 'string' && email.length <= 254 && Number.isSafeInteger(amountKobo) && amountKobo > 0 && REFERENCE.test(reference),
      'INVALID_PAYMENT', 'The payment details are invalid.');
    const data = await request('/transaction/initialize', 'POST', { email, amount: amountKobo, currency: 'NGN', reference, callback_url: config.callbackUrl });
    let checkout;
    try { checkout = new URL(data.authorization_url); } catch { throw unavailable(); }
    if (data.reference !== reference || checkout.protocol !== 'https:' || checkout.hostname !== 'checkout.paystack.com' || checkout.port || checkout.username || checkout.password || checkout.hash || checkout.href.length > 2048) throw unavailable();
    return { reference: data.reference, checkoutUrl: checkout.href };
  }
  async function verify(reference) {
    check(typeof reference === 'string' && REFERENCE.test(reference), 'INVALID_PAYMENT', 'The payment reference is invalid.');
    const data = await request(`/transaction/verify/${encodeURIComponent(reference)}`);
    return { reference: data.reference, amountKobo: data.amount, currency: data.currency, domain: data.domain,
      status: STATUSES.has(data.status) ? data.status : 'unknown', transactionId: data.id == null ? null : String(data.id) };
  }
  function verifyWebhook(raw, signature) {
    if (!configured || !Buffer.isBuffer(raw) || typeof signature !== 'string' || !/^[a-f0-9]{128}$/i.test(signature)) return false;
    const expected = createHmac('sha512', config.secretKey).update(raw).digest();
    return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
  }
  return Object.freeze({ enabled, configured, mode: config.mode, wallets: Object.freeze([...(config.wallets ?? [])]), initialize, verify, verifyWebhook });
}
