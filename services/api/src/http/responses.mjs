import { ApplicationError } from '../shared/errors.mjs';
import { FareError } from '../../../../packages/shared/src/fare-negotiation.mjs';

const statuses = new Map([
  ...['UNAUTHENTICATED', 'INVALID_CREDENTIALS'].map((code) => [code, 401]),
  ...['FORBIDDEN', 'DRIVER_NOT_APPROVED', 'DRIVER_NOT_ELIGIBLE', 'INVALID_HOST', 'INVALID_ORIGIN', 'INVALID_CSRF', 'INVALID_PROXY'].map((code) => [code, 403]),
  ['STAGING_ACCESS_REQUIRED', 401], ['SERVER_DRAINING', 503],
  ['NOT_FOUND', 404], ['METHOD_NOT_ALLOWED', 405], ['JSON_REQUIRED', 415], ['BODY_TOO_LARGE', 413],
  ...['AUTH_BUSY', 'RATE_LIMITED'].map((code) => [code, 429]),
  ['MAPS_BUSY', 429], ['MAPS_UNAVAILABLE', 503],
  ['PAYMENT_VERIFICATION_FAILED', 502],
  ...['EMAIL_IN_USE', 'ADMIN_EXISTS', 'ACCOUNT_HAS_RIDES', 'KEY_REUSED', 'OPEN_REQUEST_EXISTS',
    'REQUEST_UNAVAILABLE', 'DRIVER_BUSY', 'REQUEST_CLOSED', 'NO_DRIVER', 'OFFER_LIMIT', 'ALREADY_REVIEWED',
    'STALE_VERSION', 'STALE_OFFER', 'NO_OFFER', 'SELF_ACCEPTANCE', 'OFFER_EXPIRED', 'NEGOTIATION_CLOSED',
    'CHAT_NOT_READY', 'CHAT_CLOSED', 'MESSAGE_LIMIT', 'INVALID_TRIP_STATE', 'PICKUP_PIN_LOCKED',
    'CALL_UNAVAILABLE', 'CALL_CLOSED', 'CALL_BUSY', 'CALL_WINDOW', 'CALL_SIGNAL_EXISTS',
    'QUOTE_USED', 'QUOTE_EXPIRED', 'LOCATION_CLOSED', 'LOCATION_BUSY', 'LOCATION_WINDOW', 'STALE_LOCATION',
    'AVAILABILITY_BUSY', 'AVAILABILITY_CLOSED', 'AVAILABILITY_WINDOW', 'DRIVER_OFFLINE', 'OUTSIDE_MATCH_AREA',
    'PAYMENT_NOT_READY', 'PAYMENT_CLOSED', 'RECEIPT_NOT_READY',
    'APPLICATION_LOCKED', 'APPLICATION_INCOMPLETE', 'DOCUMENT_STORAGE_FULL',
    'CONTACT_LIMIT', 'CONTACT_EXISTS', 'SAFETY_UNAVAILABLE', 'INCIDENT_OPEN', 'INCIDENT_LIMIT', 'INCIDENT_CLOSED',
    'NOTIFICATION_CLOSED', 'LINK_LIMIT', 'LINK_CLOSED']
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
  if (result.status === 429) response.setHeader('Retry-After', error.code === 'MAPS_BUSY' ? '2' : '60');
  json(response, result.status, result.body);
}
