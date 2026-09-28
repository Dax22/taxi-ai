import { createApiClient } from './dashboard/api-client.mjs';
import { createParcelsController } from './parcels/controller.mjs';
import { createParcelsView } from './parcels/view.mjs';

let serverTime = { now: Date.now(), received: performance.now() };
const client = createApiClient({ onServerTime(now) { serverTime = { now, received: performance.now() }; } });
const view = createParcelsView({ onSelect: (id) => controller.select(id), onAccept: () => void controller.accept(), onRefresh: () => void controller.refresh(), now: () => serverTime.now + performance.now() - serverTime.received });
let candidate = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
const controller = createParcelsController({ client, view, now: () => serverTime.now + performance.now() - serverTime.received, token: /^[a-f0-9]{64}$/.test(candidate) ? candidate : '',
  onAccepted() { history.replaceState(null, '', '/parcels'); } });
candidate = '';
document.addEventListener('visibilitychange', () => { if (document.hidden) controller.pause(); else void controller.resume(); });
window.addEventListener('pagehide', () => controller.close());
setInterval(() => { if (!document.hidden) void controller.refresh(); }, 10_000);
setInterval(() => { if (!document.hidden) { controller.tick(); view.tick(); } }, 5000);
if (document.hidden) controller.pause(); else void controller.refresh();
