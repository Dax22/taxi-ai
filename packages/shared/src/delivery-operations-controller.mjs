import { readDeliveryOperations } from './delivery-operations.mjs';
/** Shared account-scoped controls; transports own credentials and the server owns permissions. */
export function createDeliveryOperationsController({ read, write, verify, makeKey, now = Date.now }) {
  let accountId = null, rideId = null, epoch = 0, lastSuccess = 0, pending = null;
  let state = { data: null, error: '', busy: false, loading: false, uncertain: false };
  const listeners = new Set();
  const publish = values => { state = { ...state, ...values }; for (const fn of listeners) fn(); };
  const current = generation => generation === epoch && Boolean(accountId && rideId);
  async function allowed(owner, generation) {
    const valid = await verify(owner);
    if (!current(generation)) return false;
    if (!valid) {
      pending = null;
      publish({ data: null, uncertain: false, error: 'Account access changed. Refresh before continuing.' });
      return false;
    }
    return true;
  }
  async function refresh() {
    if (!accountId || !rideId || state.busy || state.loading) return;
    const generation = epoch, owner = accountId, id = rideId, started = now(); publish({ loading: true });
    try {
      if (!await allowed(owner, generation)) return;
      const body = await read(id);
      if (!await allowed(owner, generation) || now() - started >= 30_000) { if (current(generation)) publish({ data: null }); return; }
      const data = readDeliveryOperations(body, id); lastSuccess = now();
      publish({ data, error: pending ? 'An action needs confirmation. Retry that same action.' : '' });
    } catch (error) { if (current(generation)) publish({ data: null, error: error.message }); }
    finally { if (current(generation)) publish({ loading: false }); }
  }
  async function execute() {
    if (!pending || state.busy || state.loading) return;
    const generation = epoch, owner = accountId, id = rideId, command = pending;
    publish({ busy: true, error: '' });
    try {
      if (!await allowed(owner, generation)) return;
      const body = await write(id, command.data, command.key);
      if (!await allowed(owner, generation)) return;
      const data = readDeliveryOperations(body, id);
      pending = null; lastSuccess = now(); publish({ data, uncertain: false });
    } catch (error) {
      if (current(generation)) {
        const definite = error.status >= 400 && error.status < 500;
        if (definite) pending = null;
        publish({ data: null, uncertain: !definite, error: definite ? error.message
          : 'Confirmation pending. Do not assume handover or return is complete. Retry the same action.' });
      }
    } finally { if (current(generation)) publish({ busy: false }); }
  }
  return Object.freeze({ snapshot: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    context(owner, id) {
      if (owner === accountId && id === rideId) return;
      epoch++; accountId = owner; rideId = id; pending = null; lastSuccess = 0;
      publish({ data: null, error: '', busy: false, loading: false, uncertain: false });
    },
    refresh,
    async command(action, extra = {}) {
      if (!current(epoch) || state.busy || state.loading || pending || !state.data) return;
      if (now() - lastSuccess >= 30_000) { publish({ data: null, error: 'Refresh before taking another delivery action.' }); return; }
      const permission = ({ report: 'report', request_return: 'requestReturn', authorize_return: 'authorizeReturn', confirm_return: 'confirmReturn', resolve: 'resolve' })[action];
      if (!permission || !state.data.can[permission]) return;
      pending = { key: makeKey(), data: { ...extra, action, expectedVersion: state.data.version } };
      await execute();
    },
    retry: execute,
    tick() { if (state.data && now() - lastSuccess >= 30_000) publish({ data: null, error: 'Delivery updates paused. Refresh to verify current access.' }); },
    close() { epoch++; accountId = rideId = null; pending = null; publish({ data: null, error: '', busy: false, loading: false, uncertain: false }); },
  });
}
