/** Owns financial requests and discards responses from old accounts/journeys. */
export function createPaymentsController({ client, view }) {
  const empty = () => ({ user: null, ride: null, payment: null, receipt: null, settings: null,
    ledger: null, before: null, busy: false, detailError: '', ledgerError: '', message: '', hostedCheckout: false });
  let state = empty(), generation = 0, detailGeneration = 0, pageGeneration = 0;
  let detailPending = null, ledgerPending = null;
  const render = () => view.render(state);
  function reset() {
    generation++; detailGeneration++; pageGeneration++;
    state = empty(); detailPending = null; ledgerPending = null; render();
  }
  function context(user, ride) {
    if (state.user?.id !== user?.id || state.user?.role !== user?.role) reset();
    state.user = user;
    const next = user && ['customer', 'driver'].includes(user.role) && ride?.status === 'completed' ? ride : null;
    if (state.ride?.id !== next?.id) {
      detailGeneration++; detailPending = null;
      Object.assign(state, { payment: null, receipt: null, settings: null, busy: false, detailError: '', message: '' });
    }
    state.ride = next; render();
  }
  async function detail() {
    if (!state.ride || state.hostedCheckout || state.busy || detailPending) return detailPending;
    const account = generation, selection = detailGeneration, id = state.ride.id;
    const current = () => account === generation && selection === detailGeneration;
    const task = (async () => {
      try {
        const data = await client.request(`/api/payments/rides/${id}`);
        if (!current()) return;
        state.payment = data.payment; state.settings = data.settings; state.detailError = '';
        if (data.payment?.status === 'paid') {
          if (state.receipt?.reference !== data.payment.attempt.reference) {
            state.receipt = null;
            const result = await client.request(`/api/payments/rides/${id}/receipt`);
            if (!current()) return;
            state.receipt = result.receipt;
          }
        } else state.receipt = null;
      } catch (error) {
        if (!current()) return;
        state.detailError = error.message;
        if ([401, 403, 404].includes(error.status)) { state.payment = null; state.receipt = null; }
      } finally { if (current()) render(); }
    })();
    detailPending = task;
    try { await task; } finally { if (detailPending === task) detailPending = null; }
  }
  async function ledger() {
    if (!['driver', 'admin'].includes(state.user?.role) || ledgerPending) return ledgerPending;
    const account = generation, page = pageGeneration;
    const path = state.user.role === 'driver' ? '/api/driver/earnings' : '/api/admin/payments';
    const current = () => account === generation && page === pageGeneration;
    const task = (async () => {
      try {
        const data = await client.request(path + (state.before ? `?before=${encodeURIComponent(state.before)}` : ''));
        if (!current()) return;
        state.ledger = data; state.ledgerError = '';
      } catch (error) {
        if (!current()) return;
        state.ledgerError = error.message;
        if ([401, 403].includes(error.status)) state.ledger = null;
      } finally { if (current()) render(); }
    })();
    ledgerPending = task;
    try { await task; } finally { if (ledgerPending === task) ledgerPending = null; }
  }
  async function command(action, displayed, outcome) {
    if (state.busy || state.hostedCheckout || state.user?.role !== 'customer' || !state.settings?.canSimulate
      || !state.payment || state.payment.rideId !== displayed.rideId || state.payment.version !== displayed.version) return;
    const account = generation, selection = ++detailGeneration;
    detailPending = null; state.busy = true; state.detailError = ''; state.message = ''; render();
    const current = () => account === generation && selection === detailGeneration;
    const path = `/api/payments/rides/${displayed.rideId}/${action === 'start' ? 'start' : `attempts/${displayed.attempt.id}/simulate`}`;
    try {
      const result = await client.command(path, { expectedVersion: displayed.version, ...(action === 'simulate' ? { outcome } : {}) });
      if (!current()) return;
      state.payment = result.payment; state.settings = result.settings;
      state.message = result.payment.status === 'paid' ? 'Simulation succeeded. No money moved.'
        : result.payment.status === 'failed' ? 'Simulation failed. You can start a new attempt.' : 'Test payment started. Choose an outcome below.';
    } catch (error) {
      if (!current()) return;
      state.detailError = error.message;
      if ([401, 403, 404].includes(error.status)) { state.payment = null; state.receipt = null; state.settings = null; }
    } finally {
      if (current()) {
        state.busy = false; render();
        // Reconcile an interrupted response before the customer makes another attempt.
        const error = state.detailError;
        await detail();
        if (current() && error && !state.detailError) { state.detailError = error; render(); }
      }
    }
  }
  function page(before) {
    if (before !== null && before !== state.ledger?.nextBefore) return;
    pageGeneration++; ledgerPending = null; state.before = before; state.ledger = null; state.ledgerError = ''; render();
    return ledger();
  }
  return Object.freeze({ context, reset, poll: () => Promise.all([detail(), ledger()]),
    setHostedCheckout(active) {
      if (state.hostedCheckout === active) return;
      detailGeneration++; detailPending = null;
      Object.assign(state, { hostedCheckout: active, payment: null, receipt: null, settings: null, busy: false, detailError: '', message: '' }); render();
    },
    start: (displayed) => command('start', displayed), simulate: (displayed, outcome) => command('simulate', displayed, outcome), page });
}
