import { check, ApplicationError } from '../shared/errors.mjs';
import { json } from './responses.mjs';

export const PAYSTACK_WEBHOOK_PATH = '/api/webhooks/paystack';

/** This precise route authenticates the original bytes using Paystack's signature. */
export function createPaystackWebhook({ provider, checkoutPayments, rateLimiter, clock }) {
  return async ({ request, response, clientAddress }) => {
    check(provider.configured ?? provider.enabled, 'NOT_FOUND', 'Endpoint not found.');
    check(request.method === 'POST', 'METHOD_NOT_ALLOWED', 'Use POST.');
    await rateLimiter.consume(`paystack-webhook:${clientAddress}`, clock(), 120, 60_000);
    check(/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type'] ?? ''), 'JSON_REQUIRED', 'Use application/json.');
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size <= 65_536) chunks.push(chunk); }
    check(size <= 65_536, 'BODY_TOO_LARGE', 'The request is too large.');
    const raw = Buffer.concat(chunks);
    check(provider.verifyWebhook(raw, request.headers['x-paystack-signature']), 'INVALID_PAYMENT_SIGNATURE', 'The payment notification could not be authenticated.');
    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch { throw new ApplicationError('INVALID_JSON', 'Send valid JSON.'); }
    if (event?.event === 'charge.success') {
      check(typeof event.data?.reference === 'string' && /^[A-Za-z0-9_.=-]{1,128}$/.test(event.data.reference), 'INVALID_PAYMENT', 'The payment reference is invalid.');
      // The body is only a hint. The service verifies against Paystack and its saved record.
      await checkoutPayments.handleVerifiedReference(event.data.reference);
    }
    json(response, 200, { received: true });
  };
}
