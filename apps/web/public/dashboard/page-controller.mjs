import { isActiveRide } from '/shared/trip-lifecycle.mjs';

const emptyState = () => ({ user: null, rides: [], available: [], drivers: [], reports: [], chatUnread: {},
  history: [], historyCursor: null, historyLoaded: false, availabilityOnline: false, sampleMatchingEnabled: false });
const closed = (ride) => ['completed', 'cancelled', 'expired'].includes(ride.status);
const identity = (session) => session.user ? `${session.user.id}:${session.user.role}:${session.csrfToken}` : null;

/** Coordinates account boundaries and dashboard actions. DOM/media adapters are injected. */
export function createPageController({ client, view, conversation, conversationView, calls, sharing,
  availability, planner, payments, onboarding, safety, authForm, feedback }) {
  let state = emptyState(), sessionKey = null, generation = 0, refreshing = null, busy = false;
  const features = [conversation, calls, sharing, availability, planner, payments, ...[onboarding, safety].filter(Boolean)];

  function clear() {
    generation++; sessionKey = null; state = emptyState(); client.reset(); view.reset();
    for (const feature of features) feature.reset();
    // Clear the old account before any subsequent request can fail or remain pending.
    view.render(state);
  }

  function session(data) {
    if (sessionKey !== identity(data)) clear();
    sessionKey = identity(data); state.user = data.user; client.setCsrf(data.csrfToken);
    view.render(state);
  }

  function selection(ride) {
    calls.setContext(state.user, ride); sharing.context(state.user, ride);
    payments.context(state.user, ride);
    safety?.context(state.user, ride);
    void conversation.show(ride, state.user); void payments.poll(); void safety?.poll();
  }

  function refresh() {
    if (refreshing) return refreshing;
    const task = (async () => {
      try {
        const first = await client.request('/api/session'); session(first);
        const epoch = generation, key = sessionKey, next = { ...state };
        if (first.user?.role === 'admin') {
          const [drivers, reports] = await Promise.all([client.request('/api/admin/drivers'), client.request('/api/admin/chat-reports')]);
          next.drivers = drivers.drivers; next.reports = reports.reports;
        } else if (first.user) {
          const [data, chat] = await Promise.all([client.request('/api/rides'), client.request('/api/chat')]);
          next.chatUnread = Object.fromEntries(chat.conversations.map((item) => [item.rideId, item.unread]));
          if (!state.historyLoaded || data.rides.some((ride) => closed(ride)
            && !state.rides.some((old) => old.id === ride.id && old.version === ride.version))) {
            const history = await client.request('/api/rides/history');
            next.history = history.rides; next.historyCursor = history.nextBefore; next.historyLoaded = true;
          }
          next.rides = data.rides; next.available = data.available;
          next.sampleMatchingEnabled = data.matchingSettings.allowSimulation;
        }
        if (epoch !== generation) return;
        if (first.user) {
          // Another tab can replace the shared cookie during the parallel reads.
          const last = await client.request('/api/session');
          if (epoch !== generation) return;
          if (identity(last) !== key) { session(last); return; }
          next.user = last.user;
        }
        state = next; view.render(state);
        const selected = view.selected(), occupied = state.rides.some((ride) => isActiveRide(ride.status));
        calls.setContext(state.user, selected); sharing.context(state.user, selected);
        onboarding?.context(state.user);
        safety?.context(state.user, selected);
        payments.context(state.user, selected); availability.context(state.user, occupied);
        void planner.setContext(state.user, occupied);
        await Promise.all([payments.poll(), availability.poll(), conversation.show(selected, state.user), onboarding?.poll(), safety?.poll()]);
        if (epoch === generation) feedback.synced();
      } catch (error) {
        if ([401, 403].includes(error.status)) clear();
        throw error;
      }
    })();
    refreshing = task;
    void task.finally(() => { if (refreshing === task) refreshing = null; }).catch(() => {});
    return task;
  }

  async function runAction(action, message) {
    if (busy) return;
    busy = true; view.setBusy(true); conversationView.setBusy(true); feedback.clear();
    const epoch = generation;
    try {
      if (refreshing) await refreshing.catch(() => {});
      if (epoch !== generation) throw new Error('Your session changed. Review this screen and try again.');
      const result = await action();
      if (message) feedback.notice(message);
      try { await refresh(); }
      catch { feedback.error('Your action was saved, but the latest view could not load. Click Refresh.'); }
      return result;
    } catch (error) {
      if ([401, 403].includes(error.status)) clear();
      feedback.error(error.message);
      if ([401, 403, 409].includes(error.status) || error.code === 'INVALID_PICKUP_PIN') {
        try { await refresh(); } catch { /* Preserve the original error. */ }
      }
    } finally { busy = false; view.setBusy(false); conversationView.setBusy(false); }
  }

  async function poll() {
    if (busy) return;
    try { await refresh(); } catch { feedback.offline(); }
  }

  function rideCommand(path, data, message) {
    return runAction(async () => {
      const result = await client.rideCommand(path, data); view.select(result.ride.id);
      if (closed(result.ride)) state.historyLoaded = false;
      return result;
    }, message);
  }

  return Object.freeze({ refresh, poll, runAction, selection, rideCommand, snapshot: () => structuredClone(state),
    availabilityChanged(online) {
      if (state.availabilityOnline !== online) { state.availabilityOnline = online; view.render(state); }
    },
    read(rideId, unread) {
      if (![...state.rides, ...state.history].some((ride) => ride.id === rideId)) return;
      state.chatUnread[rideId] = unread; view.render(state);
    },
    authenticate: (path, data) => runAction(async () => {
      const result = await client.request(path, { method: 'POST', data }); session(result); authForm.reset();
    }),
    logout: () => runAction(async () => {
      onboarding?.reset(); safety?.reset(); calls.reset(); payments.reset(); void availability.stop(); availability.reset();
      sharing.shutdown(); sharing.reset(); planner.reset();
      await client.request('/api/auth/logout', { method: 'POST' }); clear();
    }),
    openRide: (id) => runAction(async () => {
      const { ride } = await client.request(`/api/rides/${id}`);
      const list = closed(ride) ? state.history : state.rides;
      const index = list.findIndex((item) => item.id === id);
      if (index < 0) list.unshift(ride); else list[index] = ride;
      view.select(id); return ride;
    }),
    history: (before) => runAction(async () => {
      const data = await client.request(`/api/rides/history${before ? `?before=${encodeURIComponent(before)}` : ''}`);
      const entries = before ? [...state.history, ...data.rides] : data.rides;
      state.history = [...new Map(entries.map((ride) => [ride.id, ride])).values()];
      state.historyCursor = data.nextBefore; state.historyLoaded = true;
    }),
  });
}
