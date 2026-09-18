import { ApplicationError } from '../shared/errors.mjs';
import { FareError } from '../../../../packages/shared/src/fare-negotiation.mjs';

const statuses = new Map([
  ...['UNAUTHENTICATED', 'INVALID_CREDENTIALS'].map((code) => [code, 401]),
  ...['FORBIDDEN', 'DRIVER_NOT_APPROVED', 'INVALID_HOST', 'INVALID_ORIGIN', 'INVALID_CSRF'].map((code) => [code, 403]),
  ['NOT_FOUND', 404], ['METHOD_NOT_ALLOWED', 405], ['JSON_REQUIRED', 415], ['BODY_TOO_LARGE', 413],
  ...['AUTH_BUSY', 'RATE_LIMITED'].map((code) => [code, 429]),
  ...['EMAIL_IN_USE', 'ADMIN_EXISTS', 'ACCOUNT_HAS_RIDES', 'KEY_REUSED', 'OPEN_REQUEST_EXISTS',
    'REQUEST_UNAVAILABLE', 'DRIVER_BUSY', 'REQUEST_CLOSED', 'NO_DRIVER', 'OFFER_LIMIT', 'ALREADY_REVIEWED',
    'STALE_VERSION', 'STALE_OFFER', 'NO_OFFER', 'SELF_ACCEPTANCE', 'OFFER_EXPIRED', 'NEGOTIATION_CLOSED']
    .map((code) => [code, 409]),
]);

export function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) });
  response.end(payload);
}

export function errorResponse(error) {
  const known = error instanceof ApplicationError || error instanceof FareError;
  const status = known ? statuses.get(error.code) ?? (error.code.startsWith('INVALID_') ? 400 : 500) : 500;
  return { status, body: { error: { code: status === 500 ? 'INTERNAL_ERROR' : error.code,
    message: status === 500 ? 'Something went wrong. Retry the same action or refresh the page.' : error.message } } };
}

export function sendError(response, error) {
  if (response.destroyed) return;
  const result = errorResponse(error);
  if (result.status === 405) response.setHeader('Allow', 'GET, POST');
  if (result.status === 429) response.setHeader('Retry-After', '60');
  json(response, result.status, result.body);
}
