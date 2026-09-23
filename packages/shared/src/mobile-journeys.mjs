import { envelope } from './mobile-contracts.mjs';
import { parseBookingRide } from './mobile-booking.mjs';
import { transportCategory } from './transport-categories.mjs';
import { NOTIFICATION_LABELS } from './notification-labels.mjs';
import { validMatchRecommendation } from './smart-matching.mjs';
import { readPassenger } from './guest-rides.mjs';
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v,max=240) => typeof v === 'string' && v.length > 0 && v.length <= max;
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const positive = (v) => integer(v) && v > 0;
const uuid = (v) => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
const mode = (v) => ['customer','work'].includes(v);
const nullableTime = (v) => v === null || integer(v);
function expect(ok) { if (!ok) throw new Error('Taxi Ai returned an incompatible journey response. Refresh and try again.'); }
function journey(r,env) {
  parseBookingRide({ ...env,ride:r });
  readPassenger(r.passenger, r.vehicleCategory, { allowPhone: r.mode === 'customer' });
  expect(mode(r.mode) && text(r.customerName) && typeof r.chatReady === 'boolean' && nullableTime(r.pinBlockedUntil)
    && (r.pickupPin === null || r.mode === 'customer' && typeof r.pickupPin === 'string' && /^\d{6}$/.test(r.pickupPin))
    && (r.mode !== 'work' || r.delivery?.dropoffPin === undefined)
    && Array.isArray(r.allowedActions) && r.allowedActions.length <= 9
    && r.allowedActions.every((a) => ['propose','accept','confirm','depart','arrive','start','complete','cancel'].includes(a)));
  expect(r.offer === null || object(r.offer) && text(r.offer.id,100) && positive(r.offer.amountKobo) && integer(r.offer.expiresAt) && typeof r.offer.fromYou === 'boolean');
  return r;
}
function availability(a) {
  expect(a === null || object(a) && uuid(a.id) && typeof a.online === 'boolean' && typeof a.owned === 'boolean'
    && (!a.owned || a.online) && ['gps','sample'].includes(a.mode) && (a.areaId === null || text(a.areaId,50))
    && positive(a.sequence) && integer(a.updatedAt) && nullableTime(a.expiresAt) && (a.reason === null || text(a.reason,50)));
}
export function parseJourney(v) { envelope(v); journey(v.ride,v); return v; }
export function parseAvailability(v) { envelope(v); availability(v.availability); return v; }
export function parseWork(v) {
  envelope(v); availability(v.availability);
  expect(object(v.settings) && typeof v.settings.allowSimulation === 'boolean' && positive(v.settings.heartbeatSeconds) && positive(v.settings.leaseSeconds)
    && positive(v.settings.freshPositionSeconds) && Array.isArray(v.areas) && v.areas.length <= 20 && v.areas.every((a) => text(a.id,50) && text(a.name))
    && Array.isArray(v.current) && v.current.length <= 50 && Array.isArray(v.available) && v.available.length <= 50
    && Array.isArray(v.activeElsewhere) && v.activeElsewhere.length <= 50 && v.activeElsewhere.every((a) => uuid(a.id) && mode(a.mode) && text(a.status,50)));
  v.current.forEach((r) => journey(r,v));
  expect(v.available.every((r) => object(r) && uuid(r.id) && integer(r.version) && transportCategory(r.vehicleCategory) && text(r.pickup) && text(r.destination)
    && positive(r.suggestedFareKobo) && integer(r.expiresAt) && (r.approximateDistanceKm === null || integer(r.approximateDistanceKm))
    && (r.recommendation === undefined || validMatchRecommendation(r.recommendation)))); return v;
}
function message(m) { expect(object(m) && uuid(m.id) && positive(m.sequence) && text(m.body,2000) && integer(m.createdAt) && typeof m.fromYou === 'boolean'); }
export function parseThread(v) {
  envelope(v); expect(uuid(v.rideId) && Array.isArray(v.messages) && v.messages.length <= 100 && typeof v.hasMore === 'boolean'
    && typeof v.canSend === 'boolean' && [v.nextAfter,v.lastSequence,v.readThrough,v.unread].every(integer)
    && v.nextAfter <= v.lastSequence && v.readThrough <= v.lastSequence && Array.isArray(v.reportedMessageIds) && v.reportedMessageIds.every(uuid));
  v.messages.forEach(message); expect(v.messages.every((m,i) => m.sequence <= v.nextAfter && (i === 0 || m.sequence > v.messages[i-1].sequence))); return v;
}
export function parseSentMessage(v) { envelope(v); message(v.message); return v; }
export function parseNotifications(v) {
  envelope(v); expect(Array.isArray(v.notifications) && v.notifications.length <= 50 && integer(v.unread)
    && (v.nextBefore === null || positive(v.nextBefore)) && object(v.push) && typeof v.push.enabled === 'boolean' && typeof v.push.registered === 'boolean'
    && (v.push.projectId === null || uuid(v.push.projectId)));
  expect(v.notifications.every((n) => object(n) && positive(n.id) && uuid(n.rideId) && mode(n.mode) && Object.hasOwn(NOTIFICATION_LABELS,n.kind)
    && n.title === NOTIFICATION_LABELS[n.kind] && integer(n.createdAt) && nullableTime(n.readAt)
    && (n.body === undefined && n.arrivalActive === undefined
      || n.kind === 'arrive' && n.mode === 'customer' && text(n.body,500) && typeof n.arrivalActive === 'boolean'))); return v;
}
export function parseNotificationTarget(v) { envelope(v); expect(object(v.target) && uuid(v.target.rideId) && mode(v.target.mode) && ['work','journey'].includes(v.target.screen)); return v; }

export function parseReadMessages(v) { envelope(v); expect(integer(v.readThrough) && integer(v.unread)); return v; }
