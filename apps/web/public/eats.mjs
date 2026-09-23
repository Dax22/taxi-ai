import { createApiClient } from './dashboard/api-client.mjs';
import { createEatsController } from '/shared/eats-controller.mjs';
import { createEatsView } from './eats/view.mjs';
import { createEatsTransport } from './eats/transport.mjs';
import { createAvailabilityController } from './dashboard/availability-controller.mjs';
import { createAvailabilityView } from './dashboard/availability-view.mjs';
import { createGeolocation } from './dashboard/geolocation.mjs';

let serverTime = { at: Date.now(), received: performance.now() }, sessionKey = null, syncing = false;
const api = createApiClient({ onServerTime(at) { serverTime = { at, received: performance.now() }; } });
const transport = createEatsTransport({ client: api, identity: () => sessionKey,
  onChanged() { api.reset(); availability.reset(); controller.reset(); sessionKey = null; } });
const controller = createEatsController({ api: transport, makeKey: () => crypto.randomUUID(), now: () => serverTime.at + performance.now() - serverTime.received });
const screenPaths = { browse: '/eats', store: '/eats/sell', orders: '/eats?screen=orders', work: '/eats?screen=work', review: '/eats?screen=review' };
const view = createEatsView(controller, {
  sellerPage: () => location.pathname === '/eats/sell',
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
function render() {
  const state = controller.snapshot(); view.render(state);
  const working = state.screen === 'work' && state.user?.driver;
  if (!working && availability.active()) availability.shutdown();
  availability.context(working ? { ...state.user, role: 'driver' } : null, Boolean(state.work?.current.length));
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
    if (changed) { api.reset(); availability.reset(); controller.reset(); sessionKey = nextKey; }
    api.setCsrf(session.csrfToken); controller.context(session.user);
    if (session.user) {
      if (changed) await route(); else await controller.refresh({ quiet: true });
      if (controller.snapshot().screen === 'work') await availability.poll();
    }
  } catch (error) {
    if (error.status === 401 || error.code === 'SESSION_CHANGED') { controller.reset(); sessionKey = null; }
    document.getElementById('food-error').textContent = error.message;
  } finally { syncing = false; }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) availability.shutdown(); else void sync(); });
window.addEventListener('pagehide', () => availability.shutdown());
window.addEventListener('popstate', () => void route());
setInterval(() => void sync(), 5000);
setInterval(() => { if (!document.hidden) { controller.tick(); availability.tick(); } }, 1000);
render(); void sync();
