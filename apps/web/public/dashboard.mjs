import { $ } from './dashboard/dom.mjs';
import { createApiClient } from './dashboard/api-client.mjs';
import { bindAuthForm } from './dashboard/auth-form.mjs';
import { createDashboardView } from './dashboard/views.mjs';
import { createConversationView } from './dashboard/conversation-view.mjs';
import { createConversationController } from './dashboard/conversation-controller.mjs';

// Page controller: owns session/view state and coordinates network work with UI.
const emptyState = () => ({ user: null, rides: [], available: [], drivers: [], reports: [], chatUnread: {},
  history: [], historyCursor: null, historyLoaded: false });
let state = emptyState();
let busy = false;
let refreshing = null;
let serverTime = { now: Date.now(), received: performance.now() };
const client = createApiClient({ onServerTime(now) { serverTime = { now, received: performance.now() }; } });
function rideCommand(path, data, message) {
  return runAction(async () => {
    const result = await client.rideCommand(path, data);
    view.select(result.ride.id);
    if (['completed', 'cancelled'].includes(result.ride.status)) state.historyLoaded = false;
  }, message);
}
const conversationView = createConversationView({
  serverNow: () => serverTime.now + performance.now() - serverTime.received,
  onAccept: rideCommand,
  onSend: (data) => runAction(() => conversation.send(data)),
  onReport: (data) => runAction(() => conversation.report(data), 'Report saved for local administrator review.'),
  onRead: () => conversation.markRead(),
});
const conversation = createConversationController({ client, view: conversationView,
  onRead(rideId, unread) { state.chatUnread[rideId] = unread; view.render(state); },
});
const view = createDashboardView({
  serverNow: () => serverTime.now + performance.now() - serverTime.received,
  onCommand: rideCommand,
  onSelectionChange: (ride) => conversation.show(ride, state.user),
  onHistory: (before) => runAction(async () => {
    const data = await client.request(`/api/rides/history${before ? `?before=${encodeURIComponent(before)}` : ''}`);
    const entries = before ? [...state.history, ...data.rides] : data.rides;
    state.history = [...new Map(entries.map((ride) => [ride.id, ride])).values()];
    state.historyCursor = data.nextBefore; state.historyLoaded = true;
  }),
  onReview: (id, decision, message) => runAction(() => client.request(`/api/admin/drivers/${id}/review`, {
    method: 'POST', data: { decision },
  }), message),
  onReportReview: (id) => runAction(() => client.request(`/api/admin/chat-reports/${id}/review`, {
    method: 'POST', data: {},
  }), 'Report marked reviewed.'),
});
const authForm = bindAuthForm({ onSubmit: (path, data) => runAction(async () => {
  const result = await client.request(path, { method: 'POST', data });
  state = { ...emptyState(), user: result.user };
  client.reset(); client.setCsrf(result.csrfToken);
  view.reset(); conversation.reset(); authForm.reset();
}) });

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const session = await client.request('/api/session');
    if (state.user?.id !== session.user?.id) {
      state = emptyState(); client.reset(); view.reset(); conversation.reset();
    }
    state.user = session.user;
    client.setCsrf(session.csrfToken);
    if (session.user?.role === 'admin') {
      const [drivers, reports] = await Promise.all([client.request('/api/admin/drivers'), client.request('/api/admin/chat-reports')]);
      state.drivers = drivers.drivers; state.reports = reports.reports;
    } else if (session.user) {
      const [data, chat] = await Promise.all([client.request('/api/rides'), client.request('/api/chat')]);
      state.chatUnread = Object.fromEntries(chat.conversations.map((item) => [item.rideId, item.unread]));
      if (!state.historyLoaded || data.rides.some((ride) => ['completed', 'cancelled'].includes(ride.status)
        && !state.rides.some((old) => old.id === ride.id && old.version === ride.version))) {
        const history = await client.request('/api/rides/history');
        state.history = history.rides; state.historyCursor = history.nextBefore; state.historyLoaded = true;
      }
      state.rides = data.rides;
      state.available = data.available;
    }
    $('sync-status').textContent = 'Up to date · refreshes every 3s';
    view.render(state);
    await conversation.show(view.selected(), state.user);
  })();
  try { await refreshing; }
  finally { refreshing = null; }
}

async function runAction(action, message) {
  if (busy) return;
  busy = true; view.setBusy(true); conversationView.setBusy(true);
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
    if ([401, 403, 409].includes(error.status) || error.code === 'INVALID_PICKUP_PIN') {
      try { await refresh(); } catch { /* Preserve the original error. */ }
    }
  } finally { busy = false; view.setBusy(false); conversationView.setBusy(false); }
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
  state = emptyState(); client.reset(); view.reset(); conversation.reset(); view.render(state);
}));
$('refresh').addEventListener('click', () => runAction(() => refresh()));
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
setInterval(() => { view.tick(); conversationView.tick(); }, 1000);
setInterval(poll, 3000);
poll();
