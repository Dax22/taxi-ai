import { createRealtimeClient } from '/shared/realtime-client.mjs';
import { createApiClient } from './dashboard/api-client.mjs';
import { createEatsController } from '/shared/eats-controller.mjs';
import { createEatsView } from './eats/view.mjs';
import { createEatsTransport } from './eats/transport.mjs';
import { createAvailabilityController } from './dashboard/availability-controller.mjs';
import { createAvailabilityView } from './dashboard/availability-view.mjs';
import { createGeolocation } from './dashboard/geolocation.mjs';
import { createFoodTracking, foodTrackingOrder } from './eats/tracking.mjs';
import { createFoodTrackingView } from './eats/tracking-view.mjs';

let serverTime = { at: Date.now(), received: performance.now() }, sessionKey = null, syncing = false;
const api = createApiClient({ onServerTime(at) { serverTime = { at, received: performance.now() }; } });
const liveUpdates = createRealtimeClient({ read: (cursor, signal) => api.request(`/api/events?cursor=${cursor}&wait=25000`, { signal }), refresh: sync });
const transport = createEatsTransport({ client: api, identity: () => sessionKey,
  onChanged() { liveUpdates.reset(); api.reset(); availability.reset(); tracking.reset(); controller.reset(); sessionKey = null; } });
const controller = createEatsController({ api: transport, makeKey: () => crypto.randomUUID(), now: () => serverTime.at + performance.now() - serverTime.received });
const screenPaths = { browse: '/eats', store: '/eats/sell', orders: '/eats?screen=orders', work: '/eats?screen=work', review: '/eats?screen=review' };
const view = createEatsView(controller, {
  sellerPage: () => location.pathname === '/eats/sell',
  beforeOrderAction: (order, action) => tracking.beforeAction(order, action),
  async navigate(screen) {
    await controller.navigate(screen);
    if (controller.snapshot().screen !== screen) return;
    const path = screenPaths[screen];
    if (path && path !== location.pathname + location.search) history.pushState({}, '', path);
    render();
  },
});
const availabilityView = createAvailabilityView({
  onOnline: (mode, areaId) => void availability.start(mode, areaId).then(() => controller.refresh({ quiet: true })),
  onOffline: () => void availability.stop().then(() => controller.refresh({ quiet: true })),
});
const availability = createAvailabilityController({
  client: { request: (path, options) => transport.request(path.slice(4), options), command: (path, data, options) => transport.command(path.slice(4), data, null, options) },
  device: createGeolocation(), view: availabilityView, serverNow: () => serverTime.at + performance.now() - serverTime.received,
});
const trackingView = createFoodTrackingView({ onStart: () => void tracking.start(), onStop: () => void tracking.stop(),
  loadSettings: async () => (await transport.request('/locations')).settings });
const tracking = createFoodTracking({ transport, device: createGeolocation(), view: trackingView,
  serverNow: () => serverTime.at + performance.now() - serverTime.received });
function render() {
  const state = controller.snapshot(); view.render(state);
  const working = state.screen === 'work' && state.user?.driver;
  if (!working && availability.active()) availability.shutdown();
  availability.context(working ? { ...state.user, role: 'driver' } : null, Boolean(state.work?.current.length));
  tracking.context(state.user, foodTrackingOrder(state, tracking.snapshot()));
}
controller.subscribe(render);
function route() {
  const params = new URLSearchParams(location.search), screen = params.get('screen');
  return controller.navigate(location.pathname === '/eats/sell' ? 'store' : ['orders','store','work','review','order'].includes(screen) ? screen : 'browse', params.get('id'));
}
async function sync() {
  if (syncing || document.hidden) return;
  syncing = true;
  try {
    const session = await api.request('/api/session'), nextKey = session.user ? `${session.user.id}:${session.csrfToken}` : null;
    const changed = nextKey !== sessionKey;
    if (changed) { liveUpdates.reset(); api.reset(); availability.reset(); tracking.reset(); controller.reset(); sessionKey = nextKey; }
    api.setCsrf(session.csrfToken); controller.context(session.user);
    if (session.user) {
      liveUpdates.resume();
      if (changed) await route(); else await controller.refresh({ quiet: true });
      if (controller.snapshot().screen === 'work') await availability.poll();
      await tracking.poll();
    }
  } catch (error) {
    if (error.status === 401 || error.code === 'SESSION_CHANGED') { liveUpdates.reset(); tracking.reset(); controller.reset(); sessionKey = null; }
    document.getElementById('food-error').textContent = error.message;
  } finally { syncing = false; }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) { liveUpdates.pause(); availability.shutdown(); } else void sync(); });
window.addEventListener('pagehide', () => { liveUpdates.reset(); availability.shutdown(); tracking.shutdown(); });
window.addEventListener('popstate', () => void route());
setInterval(() => { if (!sessionKey) void sync(); }, 30_000);
setInterval(() => { if (!document.hidden) { controller.tick(); availability.tick(); } tracking.tick(); }, 1000);
setInterval(() => { if (!document.hidden && sessionKey) void tracking.poll(); }, 10_000);
render(); void sync();
