import { createApiClient } from './dashboard/api-client.mjs';
import { createFamilyController } from './family/controller.mjs';
import { createFamilyView } from './family/view.mjs';
import { createRealtimeClient } from '/shared/realtime-client.mjs';
import { $ } from './dashboard/dom.mjs';

let serverTime = { now: Date.now(), received: performance.now() }, scope = null;
const client = createApiClient({ onServerTime(now) { serverTime = { now, received: performance.now() }; } });
const view = createFamilyView({ onCommand: (action, data) => void family.command(action, data), onSelect: id => void family.select(id), onClose: () => family.closeTrip(), onMaps: () => void family.maps() });
const family = createFamilyController({ client, view, now: () => serverTime.now + performance.now() - serverTime.received,
  onIdentity(identity) { if (scope === identity) return; scope = identity; updates.reset(); if (identity && !document.hidden) updates.resume(); } });
const updates = createRealtimeClient({ read: (cursor, signal) => client.request(`/api/events?cursor=${cursor}&wait=25000`, { signal }), refresh: () => family.refresh(), onError: error => family.invalidate(error) });
$('family-refresh').addEventListener('click', () => void family.refresh());
$('family-logout').addEventListener('click', () => void family.logout());
$('family-invite-form').addEventListener('submit', event => {
  event.preventDefault(); if (!$('family-adult').checked) return;
  const email = $('family-email').value.trim(); $('family-email').value = '';
  void family.command('invite', { email, adultConfirmed: true });
});
$('family-share-form').addEventListener('submit', event => {
  event.preventDefault(); const rideId = $('family-ride').value, contactId = $('family-contact').value;
  if (rideId && contactId) void family.command('share', { rideId, contactId });
});
function pause() { updates.pause(); family.suspend(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else void family.resume(); });
window.addEventListener('pagehide', pause);
window.addEventListener('pageshow', event => { if (event.persisted && !document.hidden) void family.resume(); });
window.addEventListener('offline', () => family.invalidate(new Error('You are offline. Reconnect to verify access again.')));
window.addEventListener('online', () => { if (!document.hidden) void family.refresh(); });
setInterval(() => { if (!document.hidden) family.tick(); }, 1000);
if (document.hidden) pause(); else void family.refresh();
