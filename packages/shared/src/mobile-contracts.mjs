/** Additive v1 wire contracts shared by HTTP contract tests and native clients. */
export const MOBILE_API_VERSION = 1;
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string';
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const texts = (v) => Array.isArray(v) && v.every(text);
const nullableText = (v) => v === null || text(v);
const vehicle = (v) => record(v) && text(v.model) && text(v.plate);
const eligibility = (v) => record(v) && typeof v.eligible === 'boolean' && texts(v.missing) && texts(v.expired);
function expect(ok) { if (!ok) throw new Error('Taxi Ai returned an incompatible response. Update the app or try again later.'); }
export function envelope(value) {
  expect(record(value) && value.apiVersion === MOBILE_API_VERSION && integer(value.serverNow)); return value;
}
export function parseAccount(value) {
  expect(record(value) && text(value.id) && text(value.name) && text(value.email)
    && value.role !== 'admin' && texts(value.capabilities) && value.capabilities.includes('customer')
    && value.capabilities.every((c) => ['customer','driver'].includes(c))
    && (value.driver === null || (record(value.driver) && text(value.driver.status) && vehicle(value.driver.vehicle) && eligibility(value.driver.eligibility)))
    && value.capabilities.includes('driver') === (value.driver !== null));
  return value;
}
export function parseSignIn(value) {
  envelope(value); parseAccount(value.user);
  const c = value.credentials, token = (t) => text(t) && /^[a-f0-9]{64}$/.test(t);
  expect(record(c) && text(c.sessionId) && token(c.accessToken) && token(c.refreshToken)
    && integer(c.accessExpiresAt) && integer(c.refreshExpiresAt)
    && c.accessExpiresAt > value.serverNow && c.refreshExpiresAt >= c.accessExpiresAt);
  return value;
}
export function parseActivity(value) {
  envelope(value);
  const ride = (r) => record(r) && text(r.id) && text(r.status) && text(r.pickup) && text(r.destination)
    && (r.fareKobo === null || integer(r.fareKobo)) && integer(r.suggestedFareKobo) && integer(r.createdAt) && typeof r.isDemo === 'boolean';
  expect(Array.isArray(value.current) && value.current.every(ride) && Array.isArray(value.history) && value.history.every(ride)
    && nullableText(value.nextBefore) && Array.isArray(value.activeElsewhere)
    && value.activeElsewhere.every((r) => record(r) && text(r.id) && text(r.status) && ['customer','work'].includes(r.mode)));
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
