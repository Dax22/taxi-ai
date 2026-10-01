const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
function check(condition) { if (!condition) throw new Error('Taxi Ai returned an incompatible delivery update. Refresh and try again.'); }
function notice(value) {
  check(object(value) && uuid(value.id) && uuid(value.targetId) && ['food', 'parcel'].includes(value.kind));
  check(['picked_up', 'arrived', 'delivered'].includes(value.phase) && text(value.title, 160) && value.title.length > 0
    && text(value.body, 1000) && value.body.length > 0 && text(value.note, 500));
  check(value.etaMinutes === null || integer(value.etaMinutes) && value.etaMinutes >= 1 && value.etaMinutes <= 2880);
  check(integer(value.createdAt) && (value.readAt === null || integer(value.readAt) && value.readAt >= value.createdAt));
  check(value.phase === 'picked_up' || value.etaMinutes === null);
  return { id: value.id, kind: value.kind, targetId: value.targetId, phase: value.phase,
    title: value.title, body: value.body, note: value.note, etaMinutes: value.etaMinutes,
    createdAt: value.createdAt, readAt: value.readAt };
}

export function readDeliveryUpdate(value, expected) {
  check(object(value) && expected && ['food', 'parcel'].includes(expected.kind) && uuid(expected.targetId));
  const update = value.update === null ? null : notice(value.update);
  check(update === null || update.kind === expected.kind && update.targetId === expected.targetId);
  return { update };
}

export function readDeliveryUpdates(value) {
  check(object(value) && Array.isArray(value.updates) && value.updates.length <= 50 && integer(value.unread));
  check(value.nextBefore === null || uuid(value.nextBefore));
  const updates = value.updates.map(notice);
  check(new Set(updates.map(update => update.id)).size === updates.length);
  return { updates, unread: value.unread, nextBefore: value.nextBefore };
}

/** A notification is only a hint: navigation always uses a newly authorized server target. */
export function readDeliveryUpdateTarget(value) {
  check(object(value) && object(value.target) && ['food-order', 'journey', 'parcels'].includes(value.target.screen) && uuid(value.target.id));
  return { target: { screen: value.target.screen, id: value.target.id } };
}
