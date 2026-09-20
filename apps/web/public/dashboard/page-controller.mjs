import { isActiveRide } from '/shared/trip-lifecycle.mjs';
import { canUseMode, accountInMode, modeForRide } from '/shared/account-modes.mjs';

const emptyState = () => ({ account: null, user: null, mode: 'customer', modePrompt: false,
  activeElsewhere: [], rides: [], available: [], drivers: [], reports: [], chatUnread: {},
  history: [], historyCursor: null, historyLoaded: false, availabilityOnline: false, sampleMatchingEnabled: false });
const closed = (ride) => ['completed', 'cancelled', 'expired'].includes(ride.status);
const identity = (session) => session.user ? `${session.user.id}:${session.user.role}:${session.csrfToken}` : null;

/** Session identity owns media. A separate, per-window mode owns workspace data. */
export function createPageController({ client, activityClient = client, view, modeView, preferences,
  conversation, conversationView, calls, sharing, availability, planner, payments, onboarding, safety, authForm, feedback }) {
  let state = emptyState(), sessionKey = null, generation = 0, refreshing = null, busy = false;
  const workspace = [conversation, planner, payments, ...[onboarding, safety].filter(Boolean)];
  const features = [...workspace, calls, sharing, availability];
  function render() { view.render(state); modeView?.render(state, busy); }
  function setBusy(value) { busy = value; view.setBusy(value); conversationView.setBusy(value); modeView?.render(state, value); }
  function clear() {
    generation++; sessionKey = null; state = emptyState(); refreshing = null; client.reset();
    if (activityClient !== client) activityClient.reset();
    view.reset(); modeView?.reset();
    for (const feature of features) feature.reset();
    render();
  }
  function session(data) {
    const changed = sessionKey !== identity(data);
    if (changed) clear();
    sessionKey = identity(data); state.account = data.user;
    if (changed && data.user) {
      const saved = preferences?.get(data.user.id);
      state.mode = canUseMode(data.user, saved) ? saved : 'customer';
    }
    if (state.mode === 'work' && !canUseMode(data.user, 'work')) resetWorkspace('customer');
    state.user = accountInMode(data.user, state.mode);
    client.setCsrf(data.csrfToken); activityClient.setCsrf(data.csrfToken);
    client.setMode?.(state.mode); render();
  }
  function resetWorkspace(mode) {
    generation++; refreshing = null;
    client.setMode?.(mode);
    const account = state.account;
    const activeElsewhere = [...state.activeElsewhere.filter((ride) => ride.mode !== mode),
      ...state.rides.filter((ride) => !closed(ride) && modeForRide(account, ride) !== mode)
        .map((ride) => ({ id: ride.id, status: ride.status, mode: modeForRide(account, ride) }))];
    state = { ...emptyState(), account, user: accountInMode(account, mode), mode,
      activeElsewhere: [...new Map(activeElsewhere.map((ride) => [ride.id, ride])).values()] };
    view.reset();
    for (const feature of workspace) feature.reset();
    if (account) preferences?.set(account.id, mode);
    render();
  }
  // Preserve an in-flight microphone request and GPS ownership when the workspace changes.
  // These controllers keep their session client and remain visible with the trip reference.
  function activityContext(selected) {
    const call = calls.snapshot?.(), tracking = sharing.snapshot?.();
    const callRide = calls.hasMedia?.() && call?.selected ? call.selected : selected;
    const trackingRide = sharing.sharing?.() && tracking?.ride ? tracking.ride : selected;
    calls.setContext(state.account, callRide);
    const currentTracking = trackingRide?.id === selected?.id ? selected : trackingRide;
    sharing.context(accountInMode(state.account, modeForRide(state.account, currentTracking)), currentTracking);
  }
  function selection(ride) {
    activityContext(ride);
    payments.context(state.user, ride); safety?.context(state.user, ride);
    void conversation.show(ride, state.user); void payments.poll(); void safety?.poll();
  }
  const scoped = (path, before = null) => `${path}?mode=${state.mode}${before ? `&before=${encodeURIComponent(before)}` : ''}`;
  function refresh() {
    if (refreshing) return refreshing;
    const start = generation;
    const task = (async () => {
      try {
        const first = await client.request('/api/session');
        if (start !== generation) return;
        session(first);
        const epoch = generation, key = sessionKey, next = { ...state };
        if (first.user?.role === 'admin') {
          const [drivers, reports] = await Promise.all([client.request('/api/admin/drivers'), client.request('/api/admin/chat-reports')]);
          next.drivers = drivers.drivers; next.reports = reports.reports;
        } else if (first.user) {
          const [data, chat] = await Promise.all([client.request(scoped('/api/rides')), client.request('/api/chat')]);
          if (epoch !== generation) return;
          next.chatUnread = Object.fromEntries(chat.conversations.filter((item) => data.rides.some((ride) => ride.id === item.rideId))
            .map((item) => [item.rideId, item.unread]));
          if (!state.historyLoaded || data.rides.some((ride) => closed(ride)
            && !state.rides.some((old) => old.id === ride.id && old.version === ride.version))) {
            const history = await client.request(scoped('/api/rides/history'));
            if (epoch !== generation) return;
            next.history = history.rides; next.historyCursor = history.nextBefore; next.historyLoaded = true;
          }
          next.rides = data.rides; next.available = data.available; next.activeElsewhere = data.activeElsewhere ?? [];
          next.sampleMatchingEnabled = data.matchingSettings.allowSimulation;
        }
        if (epoch !== generation) return;
        if (first.user) {
          const last = await client.request('/api/session');
          if (epoch !== generation) return;
          if (identity(last) !== key) { session(last); return; }
          next.account = last.user; next.user = accountInMode(last.user, next.mode);
        }
        state = next; render();
        const selected = view.selected(), occupied = state.activeElsewhere.length > 0 || state.rides.some((ride) => isActiveRide(ride.status));
        activityContext(selected); onboarding?.context(state.user); safety?.context(state.user, selected);
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
    setBusy(true); feedback.clear();
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
    } finally { setBusy(false); }
  }
  async function switchMode(mode, confirmOffline = false) {
    if (!canUseMode(state.account, mode) || mode === state.mode) return false;
    if (busy || client.pendingWrites?.()) { feedback.error('Wait for the current action to finish before changing mode.'); return false; }
    setBusy(true); feedback.clear();
    const key = sessionKey;
    try {
      if (mode === 'customer' && !await availability.prepareSwitch(confirmOffline)) {
        state.modePrompt = true; return false;
      }
      if (key !== sessionKey || client.pendingWrites?.()) throw new Error('The current action changed. Refresh before switching.');
      resetWorkspace(mode);
      // Clear other mode controls immediately, even when the next network request fails.
      activityContext(null); onboarding?.context(state.user); safety?.context(state.user, null);
      payments.context(state.user, null); availability.context(state.user, false);
      void planner.setContext(state.user, true);
      await refresh(); modeView?.focus(); return true;
    } catch (error) { feedback.error(error.message); return false; }
    finally { setBusy(false); }
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
  return Object.freeze({ refresh, poll, runAction, selection, rideCommand, switchMode, snapshot: () => structuredClone(state),
    cancelSwitch() { state.modePrompt = false; render(); },
    async addDriver(vehicle) {
      const result = await runAction(async () => {
        const result = await client.command('/api/account/driver-profile', { vehicle });
        state.account = result.user; resetWorkspace('work'); modeView?.reset();
        feedback.notice('Your car details are saved. Complete your driver application below; approval is required before accepting rides.');
        return result;
      });
      if (result) onboarding?.focus();
      return result;
    },
    availabilityChanged(online) {
      if (state.availabilityOnline !== online) { state.availabilityOnline = online; render(); }
    },
    read(rideId, unread) {
      if (![...state.rides, ...state.history].some((ride) => ride.id === rideId)) return;
      state.chatUnread[rideId] = unread; render();
    },
    authenticate: (path, data) => runAction(async () => {
      const result = await client.request(path, { method: 'POST', data }); session(result); authForm.reset();
    }),
    logout: () => runAction(async () => {
      onboarding?.reset(); safety?.reset(); calls.reset(); payments.reset(); void availability.stop(); availability.reset();
      sharing.shutdown(); sharing.reset(); planner.reset();
      await client.request('/api/auth/logout', { method: 'POST' });
      if (state.account) preferences?.clear(state.account.id);
      clear();
    }),
    async openRide(id) {
      if (busy) return;
      let ride;
      try { ({ ride } = await client.request(`/api/rides/${id}`)); }
      catch (error) { feedback.error(error.message); return; }
      const mode = modeForRide(state.account, ride);
      if (mode !== state.mode && !await switchMode(mode)) return;
      return runAction(async () => {
        const list = closed(ride) ? state.history : state.rides;
        const index = list.findIndex((item) => item.id === id);
        if (index < 0) list.unshift(ride); else list[index] = ride;
        view.select(id); return ride;
      });
    },
    history: (before) => runAction(async () => {
      const data = await client.request(scoped('/api/rides/history', before));
      const entries = before ? [...state.history, ...data.rides] : data.rides;
      state.history = [...new Map(entries.map((ride) => [ride.id, ride])).values()];
      state.historyCursor = data.nextBefore; state.historyLoaded = true;
    }),
  });
}
