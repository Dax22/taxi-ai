const kinds = new Set(['recipient_unavailable', 'incorrect_pin', 'damaged_parcel', 'failed_delivery', 'return_requested', 'return_authorized', 'return_received', 'resolved']);
const states = new Set(['normal', 'exception', 'return_requested', 'return_authorized', 'returned', 'delivered', 'closed']);
const permissions = ['report', 'requestReturn', 'authorizeReturn', 'confirmReturn', 'resolve'];
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const only = (v, keys) => Object.keys(v).every(key => keys.includes(key));
const integer = v => Number.isSafeInteger(v) && v >= 0;
const uuid = v => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
const text = (v, max) => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);
function expect(ok) { if (!ok) throw new Error('Delivery record is incompatible. Refresh before taking another action.'); }
export const DELIVERY_OPERATION_STATES = Object.freeze({ normal: 'Delivery continuing', exception: 'Delivery issue needs attention',
  return_requested: 'Return requested', return_authorized: 'Returning to sender', returned: 'Returned to sender — not delivered',
  delivered: 'Delivered — handover verified', closed: 'Delivery closed' });
export function readDeliveryOperations(body, rideId) {
  expect(object(body) && only(body, ['operations', 'replayed', 'serverNow', 'apiVersion']));
  const value = body.operations;
  expect(object(value) && only(value, ['rideId', 'version', 'state', 'events', 'evidence', 'can'])
    && uuid(value.rideId) && value.rideId === rideId && integer(value.version) && value.version <= 100 && states.has(value.state)
    && Array.isArray(value.events) && value.events.length === value.version);
  for (const [index, event] of value.events.entries()) expect(object(event)
    && only(event, ['id', 'kind', 'label', 'createdAt', 'version', 'note']) && uuid(event.id) && kinds.has(event.kind)
    && text(event.label, 160) && integer(event.createdAt) && event.version === index + 1
    && (event.note === undefined || text(event.note, 500)));
  expect(object(value.can) && only(value.can, permissions) && permissions.every(key => typeof value.can[key] === 'boolean'));
  const e = value.evidence;
  expect(e === null || object(e) && only(e, ['reference', 'verifiedAt', 'method', 'locationRecorded', 'position'])
    && e.reference === `PARCEL-${rideId.slice(0, 8).toUpperCase()}` && integer(e.verifiedAt)
    && e.method === 'recipient_pin' && typeof e.locationRecorded === 'boolean');
  if (e && e.position !== undefined && e.position !== null) {
    const p = e.position;
    expect(object(p) && only(p, ['lat', 'lng', 'accuracy', 'capturedAt']) && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90
      && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180 && Number.isFinite(p.accuracy) && p.accuracy > 0 && p.accuracy <= 200
      && integer(p.capturedAt) && e.locationRecorded);
  }
  if (['returned', 'closed', 'delivered'].includes(value.state)) expect(permissions.every(key => value.can[key] === false));
  expect(value.state !== 'returned' || e === null);
  return value;
}
