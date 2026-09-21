/** Native safety wire contracts. Projections deliberately exclude staff IDs and private credentials. */
export const SAFETY_PREVIEW_NOTICE = 'This preview saves test records only. It does not send alerts, contact emergency services or dispatch help. For an actual emergency, use your phone to contact local emergency services or someone you trust.';
export const SAFETY_OPTIONS = Object.freeze([
  { id: 'need_help', label: 'Need help / test SOS' },
  { id: 'possible_crash', label: 'Possible crash (manually reported)' },
  { id: 'unsafe_behaviour', label: 'Unsafe behaviour' },
  { id: 'other', label: 'Other safety concern' },
]);
export const SAFETY_SHARE_MINUTES = Object.freeze([15, 30, 60]);
export const safetyId = (v) => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
function requireValue(ok) { if (!ok) throw new Error('Taxi Ai returned incompatible safety data. Refresh before continuing.'); }
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const number = (v) => Number.isSafeInteger(v) && v >= 0;
const text = (v, max = 500) => typeof v === 'string' && v.length <= max;
function base(body) {
  requireValue(record(body) && body.mode === 'simulation' && safetyId(body.viewerId) && number(body.serverNow));
  return { mode: 'simulation', viewerId: body.viewerId, serverNow: body.serverNow };
}
function contact(v) {
  requireValue(record(v) && safetyId(v.id) && text(v.name, 80) && /^\+[1-9]\d{7,14}$/.test(v.phone)
    && number(v.version) && v.verified === false);
  return { id: v.id, name: v.name, phone: v.phone, version: v.version, verified: false };
}
function share(v) {
  if (v === null) return null;
  requireValue(record(v) && safetyId(v.id) && safetyId(v.rideId) && typeof v.active === 'boolean' && number(v.version)
    && number(v.createdAt) && number(v.expiresAt) && v.expiresAt > v.createdAt);
  return { id: v.id, rideId: v.rideId, active: v.active, version: v.version, createdAt: v.createdAt, expiresAt: v.expiresAt };
}
function location(v) {
  if (v === null) return null;
  requireValue(record(v) && Number.isFinite(v.lat) && v.lat >= -90 && v.lat <= 90 && Number.isFinite(v.lng) && v.lng >= -180 && v.lng <= 180
    && Number.isFinite(v.accuracy) && v.accuracy >= 0 && number(v.capturedAt) && typeof v.stale === 'boolean' && v.source === 'driver_shared');
  return { lat: v.lat, lng: v.lng, accuracy: v.accuracy, capturedAt: v.capturedAt, stale: v.stale, source: v.source };
}
function incident(v) {
  requireValue(record(v) && safetyId(v.id) && safetyId(v.rideId) && SAFETY_OPTIONS.some((option) => option.id === v.kind)
    && ['open', 'acknowledged', 'resolved'].includes(v.status) && number(v.version) && text(v.note)
    && number(v.createdAt) && number(v.updatedAt) && text(v.driverName, 120) && text(v.vehiclePlate, 40)
    && Array.isArray(v.notifications) && v.notifications.length <= 3 && Array.isArray(v.events) && v.events.length <= 3);
  const notifications = v.notifications.map((n) => {
    requireValue(record(n) && safetyId(n.id) && text(n.recipientName, 80) && /^••••\d{4}$/.test(n.recipientPhone)
      && n.mode === 'simulation' && ['queued', 'sent', 'delivered', 'failed', 'cancelled'].includes(n.status)
      && number(n.attempts) && n.attempts <= 3 && number(n.updatedAt));
    return { id: n.id, recipientName: n.recipientName, recipientPhone: n.recipientPhone, mode: 'simulation', status: n.status, attempts: n.attempts, updatedAt: n.updatedAt };
  });
  const events = v.events.map((e) => {
    requireValue(record(e) && ['created', 'acknowledged', 'resolved'].includes(e.action) && text(e.note) && number(e.createdAt));
    return { action: e.action, note: e.note, createdAt: e.createdAt };
  });
  return { id: v.id, rideId: v.rideId, kind: v.kind, status: v.status, version: v.version, note: v.note,
    createdAt: v.createdAt, updatedAt: v.updatedAt, driverName: v.driverName, vehiclePlate: v.vehiclePlate,
    location: location(v.location), notifications, events };
}
export function parseSafetyContacts(body) {
  const result = base(body); requireValue(Array.isArray(body.contacts) && body.contacts.length <= 3);
  const contacts = body.contacts.map(contact); requireValue(new Set(contacts.map((c) => c.id)).size === contacts.length);
  return { ...result, contacts };
}
export function parseTripSafety(body) {
  const result = base(body); requireValue(safetyId(body.rideId) && typeof body.canRaise === 'boolean' && Array.isArray(body.incidents) && body.incidents.length <= 20);
  const incidents = body.incidents.map(incident), link = share(body.share);
  requireValue(incidents.every((i) => i.rideId === body.rideId) && (!link || link.rideId === body.rideId));
  return { ...result, rideId: body.rideId, canRaise: body.canRaise, incidents, share: link, location: location(body.location) };
}
export function parseSafetyMutation(body) {
  const result = base(body); requireValue(typeof body.replayed === 'boolean');
  const keys = ['contact', 'incident', 'share'].filter((k) => Object.hasOwn(body, k)); requireValue(keys.length === 1);
  if (keys[0] === 'contact') return { ...result, replayed: body.replayed, contact: body.contact === null ? null : contact(body.contact) };
  if (keys[0] === 'incident') return { ...result, replayed: body.replayed, incident: incident(body.incident) };
  const link = share(body.share);
  requireValue(body.token === null || typeof body.token === 'string' && /^[a-f0-9]{64}$/.test(body.token));
  requireValue(body.token === null || !body.replayed && link?.active === true);
  return { ...result, replayed: body.replayed, share: link, token: body.token };
}
export function safetyCommandPath(command) {
  requireValue(record(command) && record(command.data));
  if (command.action === 'contact.add') return '/safety/contacts';
  requireValue(safetyId(command.id));
  switch (command.action) {
    case 'contact.edit': return `/safety/contacts/${command.id}/edit`;
    case 'contact.remove': return `/safety/contacts/${command.id}/remove`;
    case 'incident.create': return `/safety/rides/${command.id}/incidents`;
    case 'link.create': return `/safety/rides/${command.id}/links`;
    case 'link.revoke': return `/safety/links/${command.id}/revoke`;
    default: throw new Error('Unsupported native safety action.');
  }
}
export function safetyLocationLabel(value, now) {
  if (!value) return 'Location unavailable. No GPS is started by opening safety or saving a report.';
  const age = Math.max(0, Math.floor((now - value.capturedAt) / 1000));
  return `${value.stale || age > 30 ? 'Stale' : 'Recent'} driver-shared location · captured ${age}s ago · accuracy ±${Math.round(value.accuracy)} m. Not continuous tracking.`;
}
