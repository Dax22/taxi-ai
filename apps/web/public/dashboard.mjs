import { $ } from './dashboard/dom.mjs';
import { createApiClient } from './dashboard/api-client.mjs';
import { bindAuthForm } from './dashboard/auth-form.mjs';
import { createDashboardView } from './dashboard/views.mjs';

// Page controller: owns session/view state and coordinates network work with UI.
const emptyState = () => ({ user: null, rides: [], available: [], drivers: [] });
let state = emptyState();
let busy = false;
let refreshing = null;
let serverTime = { now: Date.now(), received: performance.now() };
const client = createApiClient({ onServerTime(now) { serverTime = { now, received: performance.now() }; } });
const view = createDashboardView({
  serverNow: () => serverTime.now + performance.now() - serverTime.received,
  onCommand: (path, data, message) => runAction(async () => {
    const result = await client.rideCommand(path, data);
    view.select(result.ride.id);
  }, message),
  onReview: (id, decision, message) => runAction(() => client.request(`/api/admin/drivers/${id}/review`, {
    method: 'POST', data: { decision },
  }), message),
});
const authForm = bindAuthForm({ onSubmit: (path, data) => runAction(async () => {
  const result = await client.request(path, { method: 'POST', data });
  state = { ...emptyState(), user: result.user };
  client.reset(); client.setCsrf(result.csrfToken);
  view.reset(); authForm.reset();
}) });

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const session = await client.request('/api/session');
    if (state.user?.id !== session.user?.id) {
      state = emptyState(); client.reset(); view.reset();
    }
    state.user = session.user;
    client.setCsrf(session.csrfToken);
    if (session.user?.role === 'admin') {
      state.drivers = (await client.request('/api/admin/drivers')).drivers;
    } else if (session.user) {
      const data = await client.request('/api/rides');
      state.rides = data.rides;
      state.available = data.available;
    }
    $('sync-status').textContent = 'Up to date · refreshes every 3s';
    view.render(state);
  })();
  try { await refreshing; }
  finally { refreshing = null; }
}

async function runAction(action, message) {
  if (busy) return;
  busy = true; view.setBusy(true);
  $('page-error').textContent = '';
  $('page-notice').textContent = '';
  try {
    if (refreshing) await refreshing.catch(() => {});
    await action();
    if (message) $('page-notice').textContent = message;
    try { await refresh(); }
    catch { $('page-error').textContent = 'Your action was saved, but the latest view could not load. Click Refresh.'; }
  } catch (error) {
    $('page-error').textContent = error.message;
    if ([401, 403, 409].includes(error.status)) {
      try { await refresh(); } catch { /* Preserve the original error. */ }
    }
  } finally { busy = false; view.setBusy(false); }
}

async function poll() {
  try { if (!busy && !document.hidden) await refresh(); }
  catch {
    $('sync-status').textContent = 'Connection lost · use Refresh to retry';
    if (!$('loading').hidden) {
      $('loading').hidden = true;
      $('auth-panel').hidden = false;
      $('page-error').textContent = 'Unable to connect. Check that Taxi Ai is running, then refresh this page.';
    }
  }
}

$('logout').addEventListener('click', () => runAction(async () => {
  await client.request('/api/auth/logout', { method: 'POST' });
  state = emptyState(); client.reset(); view.reset(); view.render(state);
}));
$('refresh').addEventListener('click', () => runAction(() => refresh()));
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
setInterval(() => view.tick(), 1000);
setInterval(poll, 3000);
poll();
