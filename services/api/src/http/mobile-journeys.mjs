import { DEMO_AREAS } from '../../../../packages/shared/src/demo-booking.mjs';
import { TRIP_TRANSITIONS, canCancelRide } from '../../../../packages/shared/src/trip-lifecycle.mjs';
import { check } from '../shared/errors.mjs';
import { fields } from '../shared/validation.mjs';
import { bookingProjection } from './mobile-booking.mjs';

function projection(ride,user,now) {
  const mode = user.id === ride.customer.id ? 'customer' : 'work', allowedActions = [];
  const permitted = mode === 'customer' || user.driver?.status === 'approved';
  const current = ride.negotiation?.currentOffer;
  const offer = current ? { id: current.id, amountKobo: current.amountKobo, expiresAt: current.expiresAt, fromYou: current.proposedBy === user.id } : null;
  if (permitted) {
    if (canCancelRide(ride.status)) allowedActions.push('cancel');
    if (ride.status === 'negotiating') {
      if (ride.negotiation.offers.length < 100) allowedActions.push('propose');
      if (offer && !offer.fromYou && now < offer.expiresAt) allowedActions.push('accept');
    }
    if (ride.status === 'agreed' && mode === 'customer') allowedActions.push('confirm');
    if (mode === 'work') for (const [action,transition] of Object.entries(TRIP_TRANSITIONS)) {
      if (ride.status === transition.from && (action !== 'start' || user.driver.eligibility.eligible)) allowedActions.push(action);
    }
  }
  return { ...bookingProjection(ride), mode, customerName: ride.customer.name, offer, allowedActions,
    route: ride.route, startedAt: ride.trip?.startedAt ?? null, rating: ride.rating ?? null,
    chatReady: permitted && Boolean(ride.driver), pickupPin: ride.trip?.pickupPin ?? null, pinBlockedUntil: ride.trip?.pinBlockedUntil ?? null };
}
const message = (value,userId) => ({ id: value.id, sequence: value.sequence, body: value.body, createdAt: value.createdAt, fromYou: value.senderId === userId });
export function createMobileJourneys({ rides, dispatch, availability, chat, clock }) {
  return async ({ path,write,user,accessToken,query,data,key,reauthenticate }) => {
    const context = { userId: user.id, sessionToken: accessToken, native: true, clientId: query.get('clientId') };
    if (path === '/work' && !write) {
      await dispatch?.refresh();
      if (reauthenticate) user = reauthenticate();
      const state = availability.get(context), list = rides.list(user,'work');
      return { ...state, settings: { ...state.settings, dispatchMode: list.matchingSettings.dispatchMode }, areas: state.settings.allowSimulation ? DEMO_AREAS : [], current: list.rides.filter((r) => !['completed','cancelled','expired'].includes(r.status)).map((r) => projection(r,user,clock())),
        activeElsewhere: list.activeElsewhere, available: list.available.map((r) => ({ id: r.id, version: r.version, vehicleCategory: r.vehicleCategory,
          pickup: r.pickup.name, destination: r.destination.name, suggestedFareKobo: r.suggestedFareKobo, expiresAt: r.expiresAt, approximateDistanceKm: r.approximateDistanceKm,
          recommendation: r.recommendation, ...(r.offer ? { offer: r.offer } : {}) })) };
    }
    const declined = path.match(/^\/work\/offers\/([a-f0-9-]{36})\/decline$/);
    if (write && declined) return dispatch.decline({ userId: user.id, offerId: declined[1], key, data });
    if (write && path === '/work/online') return availability.command(context,'online',null,data,key);
    const lease = path.match(/^\/work\/([a-f0-9-]{36})\/(offline|heartbeat)$/);
    if (write && lease) return lease[2] === 'offline' ? availability.command(context,'offline',lease[1],data,key) : availability.update(context,lease[1],data);
    const rating = path.match(/^\/journeys\/([a-f0-9-]{36})\/rating$/);
    if (write && rating) return { ride: projection(rides.rate(user,rating[1],data).ride,user,clock()) };
    const journey = path.match(/^\/journeys\/([a-f0-9-]{36})(?:\/(claim|propose|accept|confirm|depart|arrive|start|complete|cancel))?$/);
    if (journey) {
      if (!write && !journey[2]) return { ride: projection(rides.get(user,journey[1]),user,clock()) };
      if (write && journey[2]) { const result = rides.mutate({ userId: user.id, action: journey[2], id: journey[1], data, key });
        return { ride: projection(result.ride,user,clock()), replayed: result.replayed }; }
    }
    const conversation = path.match(/^\/journeys\/([a-f0-9-]{36})\/chat(?:\/(messages|read)|\/messages\/([a-f0-9-]{36})\/report)?$/);
    if (conversation) {
      const id = conversation[1];
      if (!write && !conversation[2] && !conversation[3]) { const thread = chat.thread(user.id,id,Number(query.get('after') ?? 0));
        return { ...thread, messages: thread.messages.map((m) => message(m,user.id)) }; }
      if (write && conversation[2] === 'messages') { const result = chat.send({ userId: user.id, rideId: id, key,data }); return { message: message(result.message,user.id), replayed: result.replayed }; }
      if (write && conversation[2] === 'read') return chat.markRead(user.id,id,data);
      if (write && conversation[3]) { chat.report(user.id,id,conversation[3],data); return { reported: true }; }
    }
    check(false,'NOT_FOUND','Journey endpoint not found.');
  };
}

export function mobileNotifications({ notifications,user,sessionId,path,write,query,data }) {
  if (!write && path === '/notifications') return notifications.list(user.id,query.has('before') ? Number(query.get('before')) : null,sessionId);
  if (write && path === '/notifications/push') return notifications.register(user.id,sessionId,data);
  if (write && path === '/notifications/push/disable') return notifications.unregister(user.id,sessionId,data);
  const match = path.match(/^\/notifications\/(\d+)\/(open|read)$/);
  if (write && match) { fields(data,[]); return notifications[match[2]](user.id,Number(match[1])); }
  check(false,'NOT_FOUND','Updates endpoint not found.');
}
