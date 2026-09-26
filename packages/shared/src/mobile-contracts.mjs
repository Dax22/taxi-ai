import { transportCategory, validPayload } from './transport-categories.mjs';
import { readPassenger } from './guest-rides.mjs';
/** Additive v1 wire contracts shared by HTTP contract tests and native clients. */
export const MOBILE_API_VERSION = 1;
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string';
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const texts = (v) => Array.isArray(v) && v.every(text);
const nullableText = (v) => v === null || text(v);
const vehicle = (v) => record(v) && text(v.model) && text(v.plate) && transportCategory(v.category)
  && (transportCategory(v.category).service === 'delivery' ? validPayload(v.category, v.payloadKg) : v.payloadKg == null)
  && ['make','modelName','colour'].every((key) => v[key] === undefined || text(v[key]))
  && (v.year === undefined || (integer(v.year) && v.year >= 1980 && v.year <= 2100));
const eligibility = (v) => record(v) && typeof v.eligible === 'boolean' && texts(v.missing) && texts(v.expired);
function expect(ok) { if (!ok) throw new Error('Taxi Ai returned an incompatible response. Update the app or try again later.'); }
export function parseVehicle(value) { expect(vehicle(value)); return value; }
export function envelope(value) {
  expect(record(value) && value.apiVersion === MOBILE_API_VERSION && integer(value.serverNow)); return value;
}
export function parseAccount(value) {
  expect(record(value) && text(value.id) && text(value.name) && text(value.email)
    && (value.emailVerified === undefined || typeof value.emailVerified === 'boolean')
    && value.role !== 'admin' && texts(value.capabilities) && value.capabilities.includes('customer')
    && value.capabilities.every((c) => ['customer','driver'].includes(c))
    && (value.driver === null || (record(value.driver) && text(value.driver.status) && vehicle(value.driver.vehicle) && eligibility(value.driver.eligibility)))
    && value.capabilities.includes('driver') === (value.driver !== null));
  return value;
}
export function parseEmailStatus(value) {
  envelope(value);
  expect(typeof value.enabled === 'boolean' && typeof value.verified === 'boolean' && text(value.email));
  return { enabled: value.enabled, verified: value.verified, email: value.email };
}
export function parseSignIn(value) {
  envelope(value); parseAccount(value.user);
  const c = value.credentials, token = (t) => text(t) && /^[a-f0-9]{64}$/.test(t);
  expect(record(c) && text(c.sessionId) && token(c.accessToken) && token(c.refreshToken)
    && integer(c.accessExpiresAt) && integer(c.refreshExpiresAt)
    && c.accessExpiresAt > value.serverNow && c.refreshExpiresAt >= c.accessExpiresAt);
  return value;
}
export function parseActivity(value, mode) {
  envelope(value);
  expect(mode === undefined || ['customer', 'work'].includes(mode));
  const ride = (r) => record(r) && transportCategory(r.vehicleCategory) && text(r.id) && text(r.status) && text(r.pickup) && text(r.destination)
    && (r.service === undefined || ['ride','delivery'].includes(r.service))
    && (r.fareKobo === null || integer(r.fareKobo)) && integer(r.suggestedFareKobo) && integer(r.createdAt) && typeof r.isDemo === 'boolean'
    && (r.driver === undefined || r.driver === null || (record(r.driver) && text(r.driver.id) && text(r.driver.name) && vehicle(r.driver.vehicle)));
  expect(Array.isArray(value.current) && value.current.every(ride) && Array.isArray(value.history) && value.history.every(ride)
    && nullableText(value.nextBefore) && Array.isArray(value.activeElsewhere)
    && value.activeElsewhere.every((r) => record(r) && text(r.id) && text(r.status) && ['customer','work'].includes(r.mode)));
  [...value.current, ...value.history].forEach(r => readPassenger(r.passenger, r.vehicleCategory, { allowPhone: mode !== 'work' }));
  return value;
}
export function parseDevices(value) {
  envelope(value);
  expect(Array.isArray(value.devices) && value.devices.every((d) => record(d) && text(d.id) && text(d.name)
    && integer(d.createdAt) && integer(d.refreshedAt) && integer(d.expiresAt) && typeof d.current === 'boolean'));
  return value.devices;
}
export function parseApplication(value) {
  envelope(value); const a = value.application;
  expect(record(a) && text(a.status) && eligibility(a.eligibility) && integer(a.documentCount) && vehicle(a.vehicle));
  return a;
}
export function parseOnboarding(value) {
  envelope(value); const a = value.application;
  const details = (d) => record(d) && text(d.legalName) && text(d.phone) && text(d.licenceNumber)
    && vehicle(d.vehicle) && text(d.vehicle.make) && text(d.vehicle.colour) && integer(d.vehicle.year);
  const kinds = ['profile_photo','driving_licence','vehicle_registration','insurance','vehicle_photo'];
  const score = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;
  const faceCheck = (f) => record(f) && typeof f.available === 'boolean' && text(f.provider)
    && ['not_started','pending','matched','needs_review','unavailable'].includes(f.status) && nullableText(f.reason)
    && (f.checkedAt === null || integer(f.checkedAt)) && (f.similarity === null || score(f.similarity))
    && (f.threshold === null || score(f.threshold)) && text(f.consentVersion) && (f.retryAfter === null || integer(f.retryAfter));
  expect(record(a) && text(a.driverId) && ['draft','submitted','changes_requested','rejected','approved'].includes(a.status)
    && integer(a.version) && typeof a.busy === 'boolean' && eligibility(a.eligibility) && nullableText(a.reviewReason)
    && (a.details === null || details(a.details)) && vehicle(a.vehicle) && Array.isArray(a.documents) && a.documents.length <= kinds.length
    && a.documents.every((d) => record(d) && text(d.id) && kinds.includes(d.kind) && text(d.name)
      && ['image/png','image/jpeg'].includes(d.mimeType) && integer(d.sizeBytes) && d.sizeBytes > 0 && d.sizeBytes <= 2 * 1024 * 1024
      && (kinds.indexOf(d.kind) === 0 || d.kind === 'vehicle_photo' ? d.expiresOn === null : text(d.expiresOn) && /^\d{4}-\d{2}-\d{2}$/.test(d.expiresOn)))
    && new Set(a.documents.map((d) => d.kind)).size === a.documents.length
    && (a.faceCheck === undefined || faceCheck(a.faceCheck)));
  return a;
}
