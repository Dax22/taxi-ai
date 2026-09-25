import { readFamilyResponse, readFamilyTripResponse } from '/shared/family.mjs';

/** Private account data stays in memory. Recheck the cookie identity around every read and write. */
export function createFamilyController({ client, view, now = Date.now, onIdentity = () => {} }) {
  let generation = 0, identity = null, user = null, family = null, trip = null, selected = null;
  let messageText = '', errorText = '';
  let suspended = false, loading = null, writing = false, queued = false, controller = null, settings = null;
  const key = session => session.user && session.user.role !== 'admin' && session.csrfToken ? `${session.user.id}:${session.csrfToken}` : null;
  const render = (message = messageText, error = errorText) => { messageText = message; errorText = error; view.render({ family, trip, user, settings, now: now(), busy: Boolean(loading) || writing, signedIn: Boolean(identity), message, error }); };
  function clear(message, error = '') { family = trip = null; render(message, error); }
  function changed() { const error = new Error('Your account changed. Refresh this page to continue.'); error.code = 'SESSION_CHANGED'; return error; }
  function valid(epoch) { return !suspended && epoch === generation; }
  async function session(expected, signal) {
    const result = await client.request('/api/session', { signal });
    if (!expected || key(result) !== expected || identity !== expected) throw changed();
    return result;
  }
  function resetIdentity() { identity = user = null; client.reset(); onIdentity(null); }
  async function readDetail(epoch, signal) {
    const id = selected;
    if (!id || !family?.trips.some(item => item.shareId === id)) { trip = null; selected = null; return; }
    const result = readFamilyTripResponse(await client.request(`/api/family/trips/${id}`, { signal }));
    await session(identity, signal);
    if (valid(epoch) && id === selected) trip = result.trip;
  }
  function refresh() {
    if (suspended) return Promise.resolve();
    if (writing) { queued = true; return Promise.resolve(); }
    if (loading) return loading;
    const epoch = generation;
    controller = new AbortController(); const signal = controller.signal;
    const task = (async () => {
      try {
        const current = await client.request('/api/session', { signal });
        if (!valid(epoch)) return;
        const next = key(current);
        if (!next) { resetIdentity(); clear('Sign in with your personal account to open Family Safety.'); return; }
        if (identity && next !== identity) { resetIdentity(); throw changed(); }
        identity = next; user = { name: current.user.name, id: current.user.id }; client.setCsrf(current.csrfToken); onIdentity(identity);
        const result = readFamilyResponse(await client.request('/api/family', { signal }));
        await session(identity, signal);
        if (!valid(epoch)) return;
        family = result.family;
        await readDetail(epoch, signal);
        if (!valid(epoch)) return;
        render('Up to date. Vehicle positions depend on the driver’s location sharing.');
      } catch (error) {
        if (!valid(epoch)) return;
        if ([401, 403].includes(error.status) || error.code === 'SESSION_CHANGED') resetIdentity();
        clear('Previous private details have been cleared.', error.message);
      } finally { if (loading === task) { loading = null; if (valid(epoch)) render(); } }
    })();
    loading = task; render('Checking your shared journeys…', ''); return task;
  }
  async function command(action, data) {
    if (suspended || writing || loading || client.pendingWrites?.() || !identity || !family) return;
    const expected = identity, epoch = generation; writing = true;
    if (['stop-sharing', 'revoke-contact'].includes(action)) { trip = null; selected = null; }
    render('Saving your choice…', '');
    try {
      await session(expected);
      if (!valid(epoch)) return;
      readFamilyResponse(await client.command(`/api/family/${action}`, data));
      await session(expected);
      if (!valid(epoch)) return;
      writing = false; await refresh();
    } catch (error) {
      if (!valid(epoch)) return;
      if ([401, 403].includes(error.status) || error.code === 'SESSION_CHANGED') resetIdentity();
      writing = false; clear('Review the latest information before trying again.', error.message);
    } finally {
      if (valid(epoch)) { writing = false; if (queued) { queued = false; await refresh(); } }
    }
  }
  async function select(id) {
    if (writing || suspended) return;
    selected = id; trip = null;
    if (loading) await loading;
    if (!suspended) await refresh();
  }
  function suspend() {
    generation++; suspended = true; controller?.abort(); controller = null; loading = null; writing = false; queued = false;
    resetIdentity(); settings = null; selected = null; clear('Family Safety is paused. Return to check access again.');
  }
  return Object.freeze({ refresh, command, select, suspend,
    resume() { suspended = false; return refresh(); },
    closeTrip() { selected = null; trip = null; render(); },
    async maps() {
      if (!identity || !trip || !trip.sharingActive) return;
      const epoch = generation;
      try { const result = await client.request('/api/locations'); await session(identity); if (valid(epoch)) { settings = result.settings; render(); } }
      catch (error) { if (valid(epoch)) clear('Unable to recheck this shared trip.', error.message); }
    },
    async logout() {
      if (writing || loading || !identity) return;
      const expected = identity;
      try { await session(expected); await client.request('/api/auth/logout', { method: 'POST', data: {} }); }
      catch (error) { clear('Could not confirm sign-out.', error.message); return; }
      suspend(); suspended = false; clear('You have signed out.');
    },
    invalidate(error) {
      if (suspended) return;
      generation++; controller?.abort(); controller = null; loading = null; writing = false; queued = false; selected = null; settings = null;
      clear('Live updates are interrupted. Private trip details have been cleared.', error?.message ?? '');
    },
    tick() { view.tick?.(trip, now()); if (trip?.location && now() - trip.location.capturedAt >= 30_000 && !trip.location.stale) { trip = { ...trip, location: { ...trip.location, stale: true } }; render(); } },
  });
}
