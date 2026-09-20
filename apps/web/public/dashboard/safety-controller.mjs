/** Account- and trip-scoped safety state. Share secrets live only in this controller. */
export function createSafetyController({ client, view, origin, copy }) {
  let user = null, ride = null, contacts = null, trip = null, queue = null, incident = null, settings = null;
  let selected = null, filter = 'open', before = null, secret = null, generation = 0, polling = null, pending = false;
  let error = '', message = '';
  const current = (epoch) => epoch === generation && Boolean(user);
  const render = () => view.render({ user, ride, contacts, trip, queue, incident, settings, filter, before, pending, error, message,
    shareUrl: secret && trip?.share?.id === secret.id && trip.share.active ? `${origin}/trip-share#${secret.token}` : '' });
  function reset() {
    generation++; user = ride = contacts = trip = queue = incident = settings = selected = secret = polling = null;
    filter = 'open'; before = null; pending = false; error = message = ''; view.reset(); render();
  }
  function context(account, journey) {
    const nextRide = account?.role === 'admin' ? null : journey;
    if (user?.id !== account?.id || user?.role !== account?.role || ride?.id !== nextRide?.id) reset();
    user = account; ride = nextRide; render();
  }
  function verify(result) {
    if (result?.viewerId !== user?.id) {
      contacts = trip = queue = incident = settings = secret = null; view.reset();
      throw new Error('Your account changed. Refresh before opening safety records again.');
    }
  }
  function poll() {
    if (!user || pending || polling) return polling;
    const epoch = generation;
    const task = (async () => {
      try {
        if (user.role === 'admin') {
          const [list, detail] = await Promise.all([
            client.request(`/api/admin/safety?status=${filter}${before ? `&before=${encodeURIComponent(before)}` : ''}`),
            selected ? client.request(`/api/safety/incidents/${selected}`) : null,
          ]);
          if (!current(epoch)) return false;
          verify(list); if (detail) verify(detail);
          if (detail && detail.incident.id !== selected) throw new Error('The incident changed. Open it again.');
          queue = list; incident = detail?.incident ?? null; settings = list.settings;
        } else {
          const [saved, journey] = await Promise.all([client.request('/api/safety/contacts'),
            ride ? client.request(`/api/safety/rides/${ride.id}`) : null]);
          if (!current(epoch)) return false;
          verify(saved); if (journey) verify(journey);
          if (journey && journey.rideId !== ride.id) throw new Error('The trip changed. Open it again.');
          contacts = saved.contacts; trip = journey; settings = saved.settings;
          if (!trip?.share?.active || trip.share.id !== secret?.id) secret = null;
        }
        error = ''; render(); return true;
      } catch (cause) {
        if (current(epoch)) {
          if ([401, 403, 404].includes(cause.status) || cause.code === 'SESSION_CHANGED') {
            contacts = trip = queue = incident = settings = secret = null; view.reset();
          }
          error = cause.message; render();
        }
        return false;
      } finally { if (polling === task) polling = null; }
    })();
    polling = task; return task;
  }
  async function run(path, data, action, notice) {
    if (!user || pending) return;
    const epoch = ++generation;
    polling = null; pending = true; error = message = ''; render();
    try {
      const result = await client.command(path, data);
      if (!current(epoch)) return;
      verify(result);
      if (result.incident) {
        if (user.role === 'admin' && result.incident.id !== selected
          || user.role !== 'admin' && result.incident.rideId !== ride?.id) throw new Error('The selected safety record changed. Refresh this page.');
        if (user.role === 'admin') incident = result.incident;
      }
      if (result.share) {
        if (result.share.rideId !== ride?.id) throw new Error('The selected trip changed. Refresh this page.');
        trip = { ...trip, share: result.share };
        secret = result.share.active && /^[a-f0-9]{64}$/.test(result.token) ? { id: result.share.id, token: result.token } : null;
      }
      view.saved(action); message = notice;
      if (action === 'link' && !secret) message = 'The link record is saved, but its private URL was not recovered. Replace the link to get a new URL.';
      pending = false; render();
      if (!await poll() && current(epoch)) { error = 'Your action was saved, but the latest records could not load. Refresh to check them.'; render(); }
    } catch (cause) {
      if (current(epoch)) {
        error = cause.message;
        if ([401, 403, 404].includes(cause.status) || cause.code === 'SESSION_CHANGED') {
          contacts = trip = queue = incident = settings = secret = null; view.reset();
        }
        pending = false; render();
        if (cause.status === 409) { const original = error; await poll(); if (current(epoch)) { error = original; render(); } }
      }
    } finally { if (current(epoch)) { pending = false; render(); } }
  }
  async function open(id) {
    if (user?.role !== 'admin' || pending) return;
    generation++; selected = id; incident = polling = null; error = message = ''; view.clearReview(); render();
    await poll(); view.focusReview();
  }
  function page(nextBefore = null, nextFilter = filter) {
    if (user?.role !== 'admin' || pending) return;
    generation++; before = nextBefore; filter = nextFilter; queue = incident = selected = polling = null;
    error = message = ''; view.clearReview(); render(); return poll();
  }
  return Object.freeze({ context, reset, poll, open, page,
    add: (data) => run('/api/safety/contacts', data, 'contact', 'Trusted contact saved. The number has not been verified.'),
    remove: (contact) => run(`/api/safety/contacts/${contact.id}/remove`, { expectedVersion: contact.version }, 'remove', 'Contact removed. Unsent test alerts were cancelled.'),
    raise: (data) => ride && run(`/api/safety/rides/${ride.id}/incidents`, data, 'incident', 'Test SOS saved. No messages have been sent to anyone.'),
    share: (minutes) => trip && run(`/api/safety/rides/${ride.id}/links`, { minutes, expectedShareId: trip.share?.active ? trip.share.id : null }, 'link', 'Private trip link created. Share it only with someone you trust.'),
    revoke: (share) => run(`/api/safety/links/${share.id}/revoke`, { expectedVersion: share.version }, 'revoke', 'Trip link revoked.'),
    review: (record, decision, note) => selected === record.id && run(`/api/admin/safety/${record.id}/review`, { expectedVersion: record.version, decision, note }, 'review', 'Administrator action saved. No emergency response was dispatched.'),
    simulate: (notification, outcome) => run(`/api/admin/safety-notifications/${notification.id}/simulate`, { expectedVersion: notification.version, outcome }, 'simulate', 'Test notification status saved. No external message was sent.'),
    async copy() {
      if (!secret || !trip?.share?.active || trip.share.id !== secret.id) return;
      const epoch = generation;
      try { await copy(`${origin}/trip-share#${secret.token}`); if (current(epoch)) { message = 'Private link copied. Anyone with it can view the shared trip until it ends.'; error = ''; render(); } }
      catch { if (current(epoch)) { error = 'Copy was unavailable. Select and copy the private link shown below.'; render(); } }
    },
  });
}
