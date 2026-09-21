import { check } from '../shared/errors.mjs';

const idPattern = '[a-f0-9-]{36}';
const position = (v) => v ? { lat: v.lat, lng: v.lng, accuracy: v.accuracy, capturedAt: v.capturedAt,
  stale: v.stale, source: v.source } : null;
const share = (v) => v ? { id: v.id, rideId: v.rideId, active: v.active, version: v.version, createdAt: v.createdAt, expiresAt: v.expiresAt } : null;
function incident(v) {
  return { id: v.id, rideId: v.rideId, kind: v.kind, status: v.status, version: v.version, note: v.note,
    createdAt: v.createdAt, updatedAt: v.updatedAt, driverName: v.snapshot.driver.name,
    vehiclePlate: v.snapshot.driver.vehicle.plate, location: position(v.snapshot.location),
    events: v.events.map(({ action, note, createdAt }) => ({ action, note, createdAt })),
    notifications: v.notifications.map(({ id, recipientName, recipientPhone, mode, status, attempts, updatedAt }) =>
      ({ id, recipientName, recipientPhone, mode, status, attempts, updatedAt })) };
}
/** Native adapter only; safety owns authorization, transactions, history and session-bound links. */
export function mobileSafety({ safety, user, accessToken, path, write, data, key }) {
  const envelope = (result) => ({ viewerId: result.viewerId, mode: 'simulation' });
  if (!write && path === '/safety/contacts') {
    const result = safety.contacts(user.id); return { ...envelope(result), contacts: result.contacts };
  }
  const trip = path.match(new RegExp(`^/safety/rides/(${idPattern})$`));
  if (!write && trip) {
    const result = safety.trip(user.id, trip[1]);
    return { ...envelope(result), rideId: result.rideId, canRaise: result.canRaise, incidents: result.incidents.map(incident), share: share(result.share), location: position(result.location) };
  }
  let action, id = null;
  if (write && path === '/safety/contacts') action = 'contact.add';
  else if (write) {
    const contact = path.match(new RegExp(`^/safety/contacts/(${idPattern})/(edit|remove)$`));
    const ride = path.match(new RegExp(`^/safety/rides/(${idPattern})/(incidents|links)$`));
    const link = path.match(new RegExp(`^/safety/links/(${idPattern})/revoke$`));
    if (contact) { id = contact[1]; action = `contact.${contact[2]}`; }
    else if (ride) { id = ride[1]; action = ride[2] === 'incidents' ? 'incident.create' : 'link.create'; }
    else if (link) { id = link[1]; action = 'link.revoke'; }
  }
  check(action, 'NOT_FOUND', 'Native safety endpoint not found.');
  const result = safety.command({ userId: user.id, nativeAccessToken: accessToken, action, id, data, key });
  const body = { ...envelope(result), replayed: result.replayed };
  if (Object.hasOwn(result, 'contact')) return { ...body, contact: result.contact };
  if (Object.hasOwn(result, 'incident')) return { ...body, incident: incident(result.incident) };
  return { ...body, share: share(result.share), token: result.token ?? null };
}
