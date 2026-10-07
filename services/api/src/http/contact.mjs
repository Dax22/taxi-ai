import { check } from '../shared/errors.mjs';
import { normalizeContactMessage } from '../shared/contact-message.mjs';
import { readBody } from './body.mjs';
import { json } from './responses.mjs';
import { requireSameOrigin } from './security.mjs';

export const CONTACT_PATH = '/api/contact';

/** Public enquiries have a fixed recipient; account and registration routes stay private. */
export function createContactRoute({ mail, rateLimiter, clock }) {
  let inFlight = 0;
  return async ({ request, response, origin, clientAddress }) => {
    if (request.method === 'GET') {
      json(response, 200, { available: mail.enabled === true });
      return;
    }
    check(request.method === 'POST', 'METHOD_NOT_ALLOWED', 'Use GET or POST.');
    requireSameOrigin(request, origin, true);
    check(mail.enabled, 'EMAIL_DISABLED', 'Online messaging is temporarily unavailable. Please email info@taxiai.app directly.');
    await rateLimiter.consume(`contact-ip:${clientAddress}`, clock(), 5, 15 * 60_000);
    const body = await readBody(request, 32_768);
    check(body && typeof body === 'object' && !Array.isArray(body)
      && Object.keys(body).every((key) => ['name', 'email', 'message', 'website'].includes(key))
      && (body.website === undefined || body.website === ''),
    'INVALID_CONTACT', 'Please complete the contact form and leave the website field empty.');
    let message;
    try { message = normalizeContactMessage(body); }
    catch { check(false, 'INVALID_CONTACT', 'Enter your name, a valid email address and a message of 10–5,000 characters.'); }
    await rateLimiter.consume(`contact-email:${message.email.toLowerCase()}`, clock(), 3, 60 * 60_000);
    await rateLimiter.consume('contact-global', clock(), 60, 60 * 60_000);
    check(inFlight < 2, 'RATE_LIMITED', 'Messages are busy right now. Please try again shortly.');
    inFlight++;
    try {
      await mail.send(message);
    } catch {
      check(false, 'EMAIL_DISABLED', 'We could not confirm delivery. Please try again later or email info@taxiai.app directly.');
    } finally {
      inFlight--;
    }
    json(response, 200, { sent: true });
  };
}
