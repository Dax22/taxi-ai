import { createApiClient } from './dashboard/api-client.mjs';
import { createParcelsController } from './parcels/controller.mjs';
import { createParcelsView } from './parcels/view.mjs';
import { createDeliveryUpdates, deliveryUpdatePath } from './dashboard/delivery-updates.mjs';
import { createDeliveryUpdateView } from './dashboard/delivery-update-view.mjs';

let serverTime = { now: Date.now(), received: performance.now() };
const client = createApiClient({ onServerTime(now) { serverTime = { now, received: performance.now() }; } });
const view = createParcelsView({ onSelect: (id) => controller.select(id), onAccept: () => void controller.accept(), onRefresh: () => void controller.refresh(), now: () => serverTime.now + performance.now() - serverTime.received });
const deliveryView = createDeliveryUpdateView({ root: document.getElementById('delivery-update-card'), banner: document.getElementById('delivery-update-banner'),
  onOpen: () => void deliveryUpdates.open(), onDismiss: () => deliveryUpdates.dismiss() });
const deliveryUpdates = createDeliveryUpdates({ client, view: deliveryView, onOpen: async target => {
  if (target.screen !== 'parcels') { location.assign(deliveryUpdatePath(target)); return; }
  await controller.refresh(); controller.select(target.id);
} });
let candidate = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
const controller = createParcelsController({ client, view: { render(state) {
  view.render(state);
  const parcel = state.parcels.find(item => item.rideId === state.selectedId), previous = deliveryUpdates.snapshot().target;
  deliveryUpdates.context(state.identity, parcel ? { kind: 'parcel', targetId: parcel.rideId } : null);
  if (previous?.targetId !== parcel?.rideId) void deliveryUpdates.poll();
} }, initialId: new URLSearchParams(location.search).get('id'), now: () => serverTime.now + performance.now() - serverTime.received, token: /^[a-f0-9]{64}$/.test(candidate) ? candidate : '',
  onAccepted() { history.replaceState(null, '', '/parcels'); } });
candidate = '';
document.addEventListener('visibilitychange', () => { if (document.hidden) controller.pause(); else void controller.resume(); });
window.addEventListener('pagehide', () => { controller.close(); deliveryUpdates.reset(); });
setInterval(() => { if (!document.hidden) void controller.refresh().then(() => deliveryUpdates.poll()); }, 10_000);
setInterval(() => { if (!document.hidden) { controller.tick(); view.tick(); } }, 5000);
if (document.hidden) controller.pause(); else void controller.refresh();
