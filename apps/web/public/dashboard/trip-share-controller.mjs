/** A bearer link grants a limited read only. Never persist the token or log requests. */
export function createTripShareController({ client, view, token: initialToken, now = Date.now }) {
  let token = /^[a-f0-9]{64}$/.test(initialToken) ? initialToken : '', generation = 0, polling = null, data = null;
  function clear(message) { data = null; view.render({ data: null, message }); }
  function close() { generation++; token = ''; polling = null; clear('This trip link is unavailable or has ended. Open a current link shared with you.'); }
  function suspend() { generation++; polling = null; clear('Trip view paused. Return to this page to check the link again.'); }
  function poll() {
    if (!token) { clear('This trip link is unavailable or has ended. Open a current link shared with you.'); return; }
    if (polling) return polling;
    const epoch = generation;
    const task = (async () => {
      try {
        const result = await client.request('/api/trip-share/view', { method: 'POST', data: { token } });
        if (epoch !== generation) return;
        if (now() >= result.expiresAt) { close(); return; }
        data = result; view.render({ data, message: 'Trip view updated. Locations are shared updates, not a guarantee of anyone’s current position.' });
      } catch (error) {
        if (epoch !== generation) return;
        if ([401, 403, 404].includes(error.status)) close();
        else clear('Unable to check this link. Previous trip details have been cleared. Use Refresh to retry.');
      } finally { if (polling === task) polling = null; }
    })();
    polling = task; return task;
  }
  return Object.freeze({ poll, close, suspend, tick() {
    if (!data) return;
    if (now() >= data.expiresAt) { close(); return; }
    if (data.trip.location && now() - data.trip.location.capturedAt >= 30_000 && !data.trip.location.stale) {
      data = { ...data, trip: { ...data.trip, location: { ...data.trip.location, stale: true } } };
      view.render({ data, message: 'The last location update is stale. Its timestamp is shown below.' });
    }
  } });
}
