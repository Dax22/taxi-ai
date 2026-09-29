import { readGuestTripResponse } from '/shared/guest-rides.mjs';

/** Public, read-only capability: only memory retains the fragment secret. */
export function createGuestTripController({ client, view, token: initialToken, now = Date.now }) {
  let token = typeof initialToken === 'string' && /^[a-f0-9]{64}$/.test(initialToken) ? initialToken : '';
  let generation = 0, polling = null, data = null, suspended = false;
  function clear(message) { data = null; view.render({ data: null, message, loading: false }); }
  function close() { generation++; token = ''; polling = null; clear('This private trip link is unavailable or has ended. Ask the person booking for a current link.'); }
  function suspend() { generation++; suspended = true; polling = null; clear('Trip view paused. Return to this page to check the link again.'); }
  function resume() { suspended = false; return poll(); }
  function poll() {
    if (suspended) return;
    if (!token) { close(); return; }
    if (polling) return polling;
    const epoch = generation;
    view.render({ data, message: 'Checking your private trip…', loading: true });
    const task = (async () => {
      try {
        const result = readGuestTripResponse(await client.request('/api/guest-trip/view', { method: 'POST', data: { token } }));
        if (epoch !== generation || suspended) return;
        if (now() >= result.expiresAt) { close(); return; }
        data = result;
        view.render({ data, loading: false, message: 'Trip updated. Driver progress is reported by the driver; location updates may be delayed.' });
      } catch (error) {
        if (epoch !== generation || suspended) return;
        if ([401, 403, 404, 410].includes(error.status)) close();
        else clear('Unable to check this link. Previous trip details have been cleared. Use Refresh to retry.');
      } finally { if (polling === task) polling = null; }
    })();
    polling = task; return task;
  }
  return Object.freeze({ poll, close, suspend, resume, tick() {
    if (!data) return;
    if (now() >= data.expiresAt) { close(); return; }
    const shared = data.guestTrip.location;
    if (shared && now() - shared.capturedAt >= 30_000 && !shared.stale) {
      data = { ...data, guestTrip: { ...data.guestTrip, location: { ...shared, stale: true } } };
      view.render({ data, loading: false, message: 'The last shared location is stale. Check its timestamp below.' });
    }
  } });
}
