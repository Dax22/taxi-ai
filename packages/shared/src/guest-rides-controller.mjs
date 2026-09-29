import { readGuestResponse } from './guest-rides.mjs';

const empty = () => ({ value: null, loading: false, pending: false, uncertain: false, error: '', token: null });

/** Memory-only owner link controls. A lost mutation reply freezes edits until the exact command is retried. */
export function createGuestRideController({ api, makeKey, now = Date.now }) {
  let state = empty(), owner = null, active = false, generation = 0, pending = null, secret = null, offset = 0;
  const listeners = new Set();
  const set = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const fresh = epoch => active && owner !== null && generation === epoch;
  const clock = () => now() + offset;
  const locked = () => !active || !owner || state.loading || state.pending || state.uncertain;
  const discardSecret = () => { secret = null; };
  function visibleToken(value) {
    const link = value?.link;
    if (!secret || !value?.canCreate || !link?.active || link.id !== secret.id || link.version !== secret.version || clock() >= link.expiresAt) discardSecret();
    return secret?.token ?? null;
  }
  function apply(response, receivedToken = false) {
    if (Number.isSafeInteger(response.serverNow) && response.serverNow >= 0) offset = response.serverNow - now();
    if (receivedToken && response.token) secret = { token: response.token, id: response.guest.link.id, version: response.guest.link.version };
    set({ value: response.guest, token: visibleToken(response.guest) });
  }
  async function load() {
    if (locked()) return;
    const epoch = generation, rideId = owner.rideId;
    set({ loading: true, error: '' });
    try {
      const response = readGuestResponse(await api.request('/guest-rides/' + rideId), rideId);
      if (fresh(epoch)) apply(response);
    } catch (error) {
      if (fresh(epoch)) { discardSecret(); set({ value: null, token: null, error: error.message || 'Could not load the passenger link.' }); }
    } finally { if (fresh(epoch)) set({ loading: false }); }
  }
  async function execute(command) {
    if (!active || !owner || state.pending) return false;
    const epoch = ++generation, rideId = owner.rideId;
    pending = command; discardSecret(); set({ pending: true, loading: false, uncertain: false, error: '', token: null });
    try {
      const response = readGuestResponse(await api.command('/guest-rides/' + rideId + command.path, command.data, command.key), rideId);
      if (!fresh(epoch)) return false;
      pending = null;
      apply(response, command.path === '/link');
      set({ pending: false, uncertain: false, error: response.replayed && command.path === '/link' && !response.token
        ? 'The passenger link was created, but its private key is no longer available. Replace it to create a new shareable link.' : '' });
      return true;
    } catch (error) {
      if (!fresh(epoch)) return false;
      const uncertain = !(Number.isInteger(error.status) && error.status >= 400 && error.status < 500 && error.status !== 408);
      if (!uncertain) pending = null;
      set({ value: null, pending: false, uncertain, token: null, error: error.message || 'Check the saved result before trying another action.' });
      return false;
    }
  }
  function run(path, data) {
    if (locked() || !state.value) return Promise.resolve(false);
    return execute({ path, data: { ...data }, key: makeKey() });
  }
  function pause() {
    active = false; generation++; discardSecret();
    state = { ...empty(), uncertain: Boolean(pending), error: pending ? 'Retry the pending link action to check its saved result.' : '' }; set({});
  }
  function context(value) {
    const same = owner?.userId === value?.userId && owner?.rideId === value?.rideId;
    if (!same) { generation++; pending = null; discardSecret(); offset = 0; state = empty(); owner = value ? { ...value } : null; }
    active = Boolean(owner);
    if (!active) { set({}); return Promise.resolve(); }
    set({});
    return load();
  }
  return Object.freeze({ snapshot: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    context, load, pause,
    create() { return state.value?.canCreate && state.value.link === null ? run('/link', { expectedLinkId: null }) : Promise.resolve(false); },
    replace() { return state.value?.canCreate && state.value.link ? run('/link', { expectedLinkId: state.value.link.id }) : Promise.resolve(false); },
    revoke() { return state.value?.link?.active ? run('/revoke', { linkId: state.value.link.id, expectedVersion: state.value.link.version }) : Promise.resolve(false); },
    retry() { return pending && !state.pending ? execute(pending) : Promise.resolve(false); },
    tick() { const token = visibleToken(state.value); if (token !== state.token) set({ token }); },
  });
}
