import { readCheckoutPaymentResponse } from '/shared/checkout-payments.mjs';

const keyOf = (target) => target ? `${target.kind}:${target.targetId}` : '';
const empty = () => ({ user: null, target: null, settings: null, payment: null, isPayer: false, canStart: false,
  loaded: false, busy: false, loading: false, uncertain: false, error: '' });

/** Hosted checkout never marks itself paid. Only authenticated API responses can do that. */
export function createCheckoutPayments({ client, view, makeKey = () => crypto.randomUUID() }) {
  let state = empty(), generation = 0, accountGeneration = 0, reading = null;
  const pending = new Map();
  const render = () => view.render(state);
  function reset() { generation++; accountGeneration++; pending.clear(); reading = null; state = empty(); render(); }
  function context(user, target) {
    if (state.user?.id !== user?.id || state.user?.role !== user?.role) reset();
    const next = user ? target : null;
    if (keyOf(next) !== keyOf(state.target)) {
      generation++; reading = null; state = { ...empty(), user, target: next };
    } else { state.user = user; state.target = next; }
    const saved = pending.get(keyOf(next)); state.busy = Boolean(saved?.inFlight); state.uncertain = Boolean(saved && !saved.inFlight);
    render();
  }
  function accept(value, target) {
    const data = readCheckoutPaymentResponse(value, target);
    Object.assign(state, { ...data, loaded: true, error: '' });
  }
  async function poll() {
    if (!state.user || !state.target || state.busy || reading) return reading;
    const epoch = generation, target = state.target;
    state.loading = true; render();
    const task = (async () => {
      try {
        const value = await client.request(`/api/checkout-payments/${target.kind}/${target.targetId}`);
        if (epoch !== generation) return;
        accept(value, target);
        if (['paid', 'refund_required'].includes(state.payment?.status)) { pending.delete(keyOf(target)); state.uncertain = false; }
      } catch (error) {
        if (epoch !== generation) return;
        state.error = error.message;
        if ([401, 403, 404].includes(error.status)) { state.payment = null; state.canStart = state.isPayer = false; state.settings = null; }
      } finally { if (reading === task) reading = null; if (epoch === generation) { state.loading = false; render(); } }
    })();
    reading = task; return task;
  }
  async function execute(command) {
    if (!state.user || keyOf(state.target) !== command.targetKey || command.inFlight) return false;
    const epoch = ++generation, account = accountGeneration, target = state.target;
    reading = null; command.inFlight = true; pending.set(command.targetKey, command);
    state.busy = true; state.loading = false; state.error = ''; render();
    let succeeded = false, reconcile = false;
    try {
      const value = await client.request(command.path, { method: 'POST', data: command.data, key: command.key });
      const checked = readCheckoutPaymentResponse(value, target);
      if (pending.get(command.targetKey) === command) pending.delete(command.targetKey);
      if (epoch !== generation) return false;
      accept(checked, target); state.uncertain = false; succeeded = true;
    } catch (error) {
      if (error.status && error.status < 500 && pending.get(command.targetKey) === command) pending.delete(command.targetKey);
      if (epoch !== generation) return false;
      state.error = error.message; state.uncertain = !error.status || error.status >= 500;
      if (!state.uncertain) { pending.delete(command.targetKey); reconcile = true; }
      if ([401, 403, 404].includes(error.status)) { state.payment = null; state.settings = null; state.canStart = state.isPayer = false; }
    } finally {
      command.inFlight = false;
      if (epoch === generation) {
        state.busy = false; render();
        if (reconcile) { const error = state.error; await poll(); if (epoch === generation) { state.error = error; render(); } }
      } else if (account === accountGeneration && keyOf(state.target) === command.targetKey) {
        const saved = pending.get(command.targetKey);
        state.busy = Boolean(saved?.inFlight); state.uncertain = Boolean(saved && !saved.inFlight); render(); void poll();
      }
    }
    return succeeded;
  }
  function command(action, displayedVersion) {
    if (!state.target || !state.loaded || state.busy || state.loading || state.uncertain || !state.isPayer
      || displayedVersion !== (state.payment?.version ?? 0) || (action === 'start' ? !state.canStart || state.payment : !state.payment)) return Promise.resolve(false);
    return execute({ targetKey: keyOf(state.target), path: `/api/checkout-payments/${state.target.kind}/${state.target.targetId}/${action}`,
      data: { expectedVersion: displayedVersion }, key: makeKey(), inFlight: false });
  }
  return Object.freeze({ context, reset, poll, snapshot: () => ({ ...state }),
    start: (version) => command('start', version), refresh: (version) => command('refresh', version),
    retry() { const saved = pending.get(keyOf(state.target)); return saved ? execute(saved) : Promise.resolve(false); },
  });
}

export function rideCheckoutTarget(user, ride) {
  return user && ['customer', 'driver'].includes(user.role) && ride && (ride.status !== 'cancelled' || ride.trip) && ['booked', 'on_way', 'arrived', 'in_progress', 'completed', 'cancelled'].includes(ride.status)
    ? { kind: 'ride', targetId: ride.id, title: ride.delivery ? 'Courier checkout' : 'Ride checkout' } : null;
}

export function foodCheckoutTarget(user, order) {
  return user && order?.role === 'customer' && order.payment?.method === 'paystack' && order.payment.targetId
    ? { kind: 'food', targetId: order.payment.targetId, title: 'Food checkout', grouped: order.payment.targetId !== order.id } : null;
}

/** Keep the original completed-trip simulator only when hosted checkout is disabled. */
export function combineRidePayments({ simulation, checkout }) {
  function mode() { const state = checkout.snapshot(); simulation.setHostedCheckout(Boolean(state.target && (!state.loaded || state.settings?.enabled !== false || state.payment))); }
  return Object.freeze({
    context(user, ride) { checkout.context(user, rideCheckoutTarget(user, ride)); simulation.context(user, ride); mode(); },
    async poll() { await checkout.poll(); mode(); await simulation.poll(); },
    reset() { checkout.reset(); simulation.reset(); },
    start: simulation.start, simulate: simulation.simulate, page: simulation.page,
  });
}
