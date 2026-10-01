import { createLocationSharing } from '../dashboard/location-sharing.mjs';
import { readFoodTracking, readFoodTrackingResult } from '/shared/food-tracking.mjs';

export const foodTrackingActive = (order) => order?.fulfillment === 'delivery' && ['assigned', 'picked_up', 'arrived'].includes(order.status)
  && ['customer', 'courier'].includes(order.role);

export function foodTrackingOrder(state, current) {
  if (current.order?.role === 'courier' && (current.sharing || current.pending)) {
    return state.order?.id === current.order.id ? state.order : state.work?.current?.find((job) => job.id === current.order.id) ?? current.order;
  }
  return state.screen === 'order' ? state.order : state.screen === 'work' ? state.work?.current?.find(foodTrackingActive) : null;
}

/** Food has its own client identity and endpoints; GPS still starts only on a button press. */
export function createFoodTracking({ transport, device, view, makeId, now = Date.now, serverNow = Date.now }) {
  let user = null, order = null, metadata = null, guidance = '', generation = 0;
  function route(path) {
    const job = /^\/api\/rides\/([^/]+)\/location(\/start)?$/.exec(path);
    if (job) return { path: `/eats/orders/${job[1]}/tracking${job[2] ?? ''}`, orderId: job[1] };
    const share = /^\/api\/location-shares\/([^/]+)\/(position|stop)$/.exec(path);
    if (share) return { path: `/eats/tracking/shares/${share[1]}/${share[2]}`, shareId: share[1], stopped: share[2] === 'stop' };
    throw new Error('Unexpected food tracking request.');
  }
  const client = {
    async request(path, options) {
      const target = route(path), epoch = generation;
      const result = await transport.request(target.path, options);
      if (target.orderId) {
        const value = readFoodTracking(result, target.orderId);
        if (epoch === generation && order?.id === target.orderId) metadata = value;
        return value;
      }
      return readFoodTrackingResult(result, target);
    },
    async command(path, data, options) {
      const target = route(path);
      return readFoodTrackingResult(await transport.command(target.path, data, null, options), target);
    },
  };
  const sharing = createLocationSharing({ client, device, makeId, now, serverNow, view: {
    renderTracking(state) {
      const fresh = state.share?.active && state.share.position && !state.share.stale && state.now - state.share.position.capturedAt < 30_000;
      if (fresh) guidance = '';
      view.renderTracking({ ...state, user, order, metadata, guidance });
    },
    resetTracking() { view.resetTracking(); },
  } });
  function context(account, selected) {
    const next = account && foodTrackingActive(selected) ? selected : null;
    if (user?.id !== account?.id || order?.id !== next?.id) { generation++; metadata = null; guidance = ''; }
    user = account; order = next;
    sharing.context(next ? { ...account, role: next.role === 'courier' ? 'driver' : 'customer' } : null,
      next ? { ...next, status: next.status === 'assigned' ? 'booked' : 'in_progress' } : null);
  }
  function beforeAction(selected, action) {
    if (selected.role !== 'courier' || !['pickup', 'arrive'].includes(action)) return true;
    const state = sharing.snapshot(), position = state.share?.position;
    if (order?.id === selected.id && state.share?.active && !state.share.stale && position && serverNow() - position.capturedAt < 30_000) return true;
    context(user, selected);
    guidance = 'Share my location is required before collecting food or confirming arrival. Allow location access and wait for a fresh update, then try this step again.';
    sharing.tick(); view.focusSharing(); void sharing.poll(); return false;
  }
  return Object.freeze({ context, beforeAction, start: sharing.start, stop: sharing.stop, poll: sharing.poll, tick: sharing.tick,
    sharing: sharing.sharing, shutdown: sharing.shutdown,
    snapshot: () => ({ ...sharing.snapshot(), order }),
    reset() { generation++; user = order = metadata = null; guidance = ''; sharing.reset(); },
  });
}
