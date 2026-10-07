import { readReceivedParcelsResponse, readParcelResponse } from '/shared/parcels.mjs';

/** Recipient reads are session-scoped; possession of a link alone never displays a parcel. */
export function createParcelsController({ client, view, token = '', initialId = null, onAccepted = () => {}, now = Date.now }) {
  let identity = null, user = null, parcels = [], selectedId = null, settings = null, busy = false, error = '', epoch = 0, paused = false;
  let preview = null, previewAt = -Infinity;
  let loading = false, loadId = 0, actionId = 0, validUntil = 0;
  const identityOf = (session) => session.user ? `${session.user.id}:${session.csrfToken}` : null;
  function render() { view.render({ identity, user, parcels, selectedId, settings, busy, loading, error, preview, hasInvitation: Boolean(token) }); }
  function session(value) {
    const next = identityOf(value);
    if (next !== identity) { epoch++; parcels = []; selectedId = null; settings = null; validUntil = 0; client.reset(); }
    identity = next; user = value.user; client.setCsrf(value.csrfToken); render();
  }
  async function refresh() {
    if (paused || loading || busy) return;
    const operation = ++loadId, startedAt = now(); loading = true; error = ''; render();
    let start = epoch;
    try {
      const account = await client.request('/api/session');
      if (paused || start !== epoch) return;
      session(account); start = epoch;
      if (!user) {
        if (token && now() - previewAt >= 60_000) {
          previewAt = now(); preview = null;
          const result = await client.request('/api/parcels/preview', { method: 'POST', data: { token } });
          if (paused || start !== epoch) return;
          const p = result.preview;
          if (!p || Object.keys(p).some(key => !['reference', 'status', 'updatedAt', 'requiresVerifiedAccount'].includes(key))
            || !/^PARCEL-[A-F0-9]{8}$/.test(p.reference) || typeof p.status !== 'string'
            || !Number.isSafeInteger(p.updatedAt) || p.requiresVerifiedAccount !== true) throw new Error('Parcel status could not be verified.');
          preview = p;
        }
        return;
      }
      const key = identity;
      const [response, maps] = await Promise.all([client.request('/api/parcels/received'), client.request('/api/locations')]);
      if (paused || start !== epoch) return;
      const current = await client.request('/api/session');
      if (paused || start !== epoch) return;
      if (identityOf(current) !== key) { session(current); return; }
      if (now() - startedAt >= 30_000) { parcels = []; selectedId = null; validUntil = 0; error = 'The tracking response took too long. Refresh to verify your current access.'; return; }
      parcels = readReceivedParcelsResponse(response).parcels; settings = maps.settings; validUntil = now() + 30_000;
      if (!parcels.some((parcel) => parcel.rideId === selectedId)) selectedId = parcels.some(parcel => parcel.rideId === initialId) ? initialId : parcels[0]?.rideId ?? null;
      initialId = null;
    } catch (failure) {
      if (!paused && start === epoch) { parcels = []; selectedId = null; error = failure.message; if ([401, 403].includes(failure.status)) session({ user: null }); }
    } finally { if (operation === loadId) { loading = false; if (!paused) render(); } }
  }
  async function accept() {
    if (paused || busy || loading || !user || !token) return;
    const operation = ++actionId; busy = true; error = ''; render();
    const start = epoch, key = identity;
    try {
      const current = await client.request('/api/session');
      if (paused || start !== epoch) return;
      if (identityOf(current) !== key) { session(current); error = 'Your account changed. Check the signed-in name before accepting.'; return; }
      const response = await client.command('/api/parcels/accept', { token });
      if (paused || start !== epoch) return;
      const last = await client.request('/api/session');
      if (paused || start !== epoch) return;
      if (identityOf(last) !== key) { session(last); return; }
      readParcelResponse(response); validUntil = now() + 30_000;
      token = ''; onAccepted(); selectedId = response.parcel.rideId;
      parcels = [response.parcel, ...parcels.filter((parcel) => parcel.rideId !== selectedId)];
    } catch (failure) { if (!paused && start === epoch) error = failure.message; }
    finally { if (operation === actionId) { busy = false; if (!paused) render(); } }
  }
  return Object.freeze({ refresh, accept,
    select(rideId) { if (parcels.some((parcel) => parcel.rideId === rideId)) { selectedId = rideId; render(); } },
    pause() { paused = true; epoch++; loadId++; actionId++; loading = busy = false; parcels = []; preview = null; previewAt = -Infinity; selectedId = null; user = null; identity = null; settings = null; validUntil = 0; client.reset(); render(); },
    resume() { paused = false; return refresh(); },
    tick() { if (validUntil && now() >= validUntil) { validUntil = 0; parcels = []; selectedId = null; error = 'Tracking updates paused. Refresh to check your recipient access and delivery progress.'; render(); } },
    close() { token = ''; this.pause(); },
  });
}
