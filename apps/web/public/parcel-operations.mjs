import { createApiClient } from './dashboard/api-client.mjs';
import { createDeliveryOperationsController } from '/shared/delivery-operations-controller.mjs';
import { DELIVERY_OPERATION_STATES } from '/shared/delivery-operations.mjs';
const $ = id => document.getElementById(id), client = createApiClient();
const id = new URLSearchParams(location.search).get('id');
const valid = typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
const path = value => `/api/parcels/${value}/operations`;
let epoch = 0, loadingSession = false;
const controller = createDeliveryOperationsController({
  read: value => client.request(path(value)),
  write: (value, data, key) => client.request(path(value), { method: 'POST', data, key }),
  verify: async owner => { const session = await client.request('/api/session'); client.setCsrf(session.csrfToken); return session.user?.id === owner; },
  makeKey: () => crypto.randomUUID(),
});
const actions = { report: 'report', request_return: 'requestReturn', authorize_return: 'authorizeReturn', confirm_return: 'confirmReturn', resolve: 'resolve' };
function render() {
  const s = controller.snapshot(), data = s.data, locked = s.busy || s.loading || s.uncertain;
  $('ops-error').textContent = s.error; $('ops-status').textContent = s.busy ? 'Waiting for server confirmation…' : s.loading ? 'Refreshing delivery record…' : s.uncertain ? 'Action confirmation is pending.' : 'Delivery record';
  $('ops-record').hidden = !data; $('ops-form').hidden = !data || !Object.values(data.can).some(Boolean); $('ops-events').replaceChildren();
  $('ops-refresh').disabled = s.busy || s.loading; $('ops-retry').hidden = !s.uncertain; $('ops-retry').disabled = s.busy || s.loading;
  for (const [action, permission] of Object.entries(actions)) { $(`ops-${action}`).hidden = !data?.can[permission]; $(`ops-${action}`).disabled = locked; }
  for (const field of ['note', 'reason', 'confirmation']) $(`ops-${field}`).disabled = locked;
  $('ops-return-box').hidden = !data?.can.confirmReturn;
  if (!data) return;
  $('ops-heading').textContent = DELIVERY_OPERATION_STATES[data.state];
  const e = data.evidence;
  $('ops-evidence').textContent = e ? `Recipient code verified at ${new Date(e.verifiedAt).toLocaleString()}. ${e.locationRecorded ? 'A courier position was recorded at handover.' : 'Fresh GPS was unavailable; no position was invented.'}${e.position ? ` Accuracy ±${e.position.accuracy} m.` : ''}` : 'No successful-delivery handover recorded.';
  for (const event of data.events) { const row = document.createElement('li'); row.textContent = `${new Date(event.createdAt).toLocaleString()} — ${event.label}${event.note ? `: ${event.note}` : ''}`; $('ops-events').append(row); }
}
async function load() {
  if (!valid || document.hidden || loadingSession) return;
  const start = epoch; loadingSession = true;
  try { const session = await client.request('/api/session'); if (document.hidden || start !== epoch) return; client.setCsrf(session.csrfToken); $('ops-login').hidden = Boolean(session.user); controller.context(session.user?.id ?? null, session.user ? id : null); await controller.refresh(); }
  catch (error) { if (start === epoch) { controller.close(); $('ops-error').textContent = error.message; } }
  finally { if (start === epoch) loadingSession = false; }
}
async function command(action) {
  const extra = { note: $('ops-note').value.trim() };
  if (action === 'report') extra.reason = $('ops-reason').value;
  if (action === 'confirm_return') extra.confirmation = $('ops-confirmation').value.trim();
  if (['authorize_return', 'confirm_return', 'resolve'].includes(action) && !window.confirm(action === 'confirm_return' ? 'Have you physically received the returned parcel?' : 'Record this instruction or resolution?')) return;
  await controller.command(action, extra);
  if (!controller.snapshot().error) { $('ops-note').value = ''; $('ops-confirmation').value = ''; }
}
controller.subscribe(render);
$('ops-form').addEventListener('submit', event => event.preventDefault());
for (const action of Object.keys(actions)) $(`ops-${action}`).addEventListener('click', () => void command(action));
$('ops-retry').addEventListener('click', () => void controller.retry()); $('ops-refresh').addEventListener('click', () => void load());
document.addEventListener('visibilitychange', () => { epoch++; loadingSession = false; controller.close(); client.reset(); $('ops-note').value = ''; $('ops-confirmation').value = ''; if (!document.hidden) void load(); });
setInterval(() => { if (!document.hidden) { controller.tick(); void load(); } }, 10_000);
render(); if (valid) void load(); else $('ops-status').textContent = 'Open the delivery record from your parcel booking.';
