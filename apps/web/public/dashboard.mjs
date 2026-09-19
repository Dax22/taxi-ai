import { $ } from './dashboard/dom.mjs';
import { createApiClient } from './dashboard/api-client.mjs';
import { bindAuthForm } from './dashboard/auth-form.mjs';
import { createDashboardView } from './dashboard/views.mjs';
import { createConversationView } from './dashboard/conversation-view.mjs';
import { createConversationController } from './dashboard/conversation-controller.mjs';
import { createCallMedia } from './dashboard/call-media.mjs';
import { createCallController } from './dashboard/call-controller.mjs';
import { createCallView } from './dashboard/call-view.mjs';
import { createLocationView } from './dashboard/location-view.mjs';
import { createLocationPlanner } from './dashboard/location-planner.mjs';
import { createLocationSharing } from './dashboard/location-sharing.mjs';
import { createGeolocation } from './dashboard/geolocation.mjs';
import { isActiveRide } from '/shared/trip-lifecycle.mjs';

// Page controller: owns session/view state and coordinates network work with UI.
const emptyState = () => ({ user: null, rides: [], available: [], drivers: [], reports: [], chatUnread: {},
  history: [], historyCursor: null, historyLoaded: false });
let state = emptyState();
let busy = false;
let refreshing = null;
let serverTime = { now: Date.now(), received: performance.now() };
const client = createApiClient({ onServerTime(now) { serverTime = { now, received: performance.now() }; } });
const callView = createCallView({ onStart: () => calls.start(), onAnswer: () => calls.answer(),
  onDecline: () => calls.decline(), onEnd: () => calls.end(), onMute: () => calls.mute(),
  onOpenRide: (id) => runAction(async () => {
    const { ride } = await client.request(`/api/rides/${id}`);
    if (!state.rides.some((item) => item.id === id)) state.rides.unshift(ride);
    view.select(id);
  }),
});
const calls = createCallController({ client, media: createCallMedia(), view: callView });
const locationView = createLocationView({ onEnable: () => planner.enable(), onSearch: (side, query) => planner.search(side, query),
  onClear: (side) => planner.clear(side), onSelect: (side, value) => planner.select(side, value), onPick: (value) => planner.pick(value),
  onTarget: (value) => planner.setTarget(value), onPreview: () => planner.preview(), onBook: () => planner.book(),
  onStart: () => sharing.start(), onStop: () => sharing.stop() });
const planner = createLocationPlanner({ client, view: locationView,
  serverNow: () => serverTime.now + performance.now() - serverTime.received,
  onOnline: (enabled, settings) => locationView.setOnline(enabled, settings),
  onBook: (quoteId) => runAction(async () => {
    const result = await client.command('/api/rides', { quoteId }); view.select(result.ride.id); return result;
  }, 'Your route and suggested fare are saved. An approved driver can start negotiation.'),
});
const sharing = createLocationSharing({ client, device: createGeolocation(), view: locationView,
  serverNow: () => serverTime.now + performance.now() - serverTime.received });
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
  onReport: (data) => runAction(() => conversation.report(data), 'Report saved for test administrator review.'),
  onRead: () => conversation.markRead(),
});
const conversation = createConversationController({ client, view: conversationView,
  onRead(rideId, unread) { state.chatUnread[rideId] = unread; view.render(state); },
});
const view = createDashboardView({
  serverNow: () => serverTime.now + performance.now() - serverTime.received,
  onCommand: rideCommand,
  onSelectionChange: (ride) => { calls.setContext(state.user, ride); sharing.context(state.user, ride); void conversation.show(ride, state.user); },
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
  view.reset(); conversation.reset(); calls.reset(); sharing.reset(); planner.reset(); authForm.reset();
}) });

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const session = await client.request('/api/session');
    if (state.user?.id !== session.user?.id) {
      state = emptyState(); client.reset(); view.reset(); conversation.reset(); calls.reset(); sharing.reset(); planner.reset();
    }
    state.user = session.user;
    calls.setContext(state.user, view.selected());
    sharing.context(state.user, view.selected());
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
    calls.setContext(state.user, view.selected());
    sharing.context(state.user, view.selected());
    void planner.setContext(state.user, state.rides.some((ride) => isActiveRide(ride.status)));
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
    const result = await action();
    if (message) $('page-notice').textContent = message;
    try { await refresh(); }
    catch { $('page-error').textContent = 'Your action was saved, but the latest view could not load. Click Refresh.'; }
    return result;
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
  calls.reset();
  sharing.shutdown(); sharing.reset(); planner.reset();
  await client.request('/api/auth/logout', { method: 'POST' });
  state = emptyState(); client.reset(); view.reset(); conversation.reset(); view.render(state);
}));
$('refresh').addEventListener('click', () => runAction(() => refresh()));
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
window.addEventListener('pagehide', () => { calls.shutdown(); sharing.shutdown(); });
setInterval(() => { view.tick(); conversationView.tick(); calls.tick(); planner.tick(); sharing.tick(); }, 1000);
setInterval(() => { if (!document.hidden || calls.hasMedia()) void calls.poll(); }, 2000);
setInterval(() => { if (!document.hidden || sharing.sharing()) void sharing.poll(); }, 3000);
setInterval(poll, 3000);
poll();
