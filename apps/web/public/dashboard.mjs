import { DEMO_AREAS, createDemoQuote, formatNaira, nairaToKobo } from '/shared/demo-booking.mjs';

const $ = (id) => document.getElementById(id);
const statuses = { requested: 'Waiting for a driver', negotiating: 'Negotiating', agreed: 'Fare agreed', cancelled: 'Cancelled' };
let state = { user: null, csrfToken: null, rides: [], available: [], drivers: [] };
let registration = false;
let selectedId = null;
let detailId = null;
let renderedLists = '';
let renderedDetail = '';
let busy = false;
let refreshing = null;
let serverTime = { now: Date.now(), received: performance.now() };
// Keep the same key after an interrupted request. Retrying cannot duplicate it.
const retryKeys = new Map();

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function api(path, { method = 'GET', data, key } = {}) {
  let response;
  try {
    response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store',
      headers: method === 'POST' ? { 'Content-Type': 'application/json',
        ...(state.csrfToken ? { 'X-CSRF-Token': state.csrfToken } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}) } : {},
      ...(method === 'POST' ? { body: JSON.stringify(data ?? {}) } : {}),
      signal: AbortSignal.timeout(12_000) });
  } catch {
    throw new Error('Connection interrupted. Check that Taxi Ai is running, then retry the same action.');
  }
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error?.message ?? 'Unable to complete this request.');
    error.status = response.status;
    error.code = body.error?.code;
    throw error;
  }
  if (Number.isFinite(body.serverNow)) serverTime = { now: body.serverNow, received: performance.now() };
  return body;
}

function selectedRide() { return state.rides.find((ride) => ride.id === selectedId); }

function updateButtons() {
  const ride = selectedRide();
  const offer = ride?.negotiation?.currentOffer;
  const remaining = offer ? offer.expiresAt - (serverTime.now + performance.now() - serverTime.received) : 0;
  const canAccept = ride?.status === 'negotiating' && offer && offer.proposedBy !== state.user?.id && remaining > 0;
  $('accept-fare').dataset.locked = String(!canAccept);
  $('fare-expiry').textContent = ride?.status === 'negotiating' && offer
    ? remaining > 0 ? `Offer expires in ${Math.ceil(remaining / 1000)} seconds.` : 'This offer expired. Send a new offer to continue.' : '';
  for (const button of document.querySelectorAll('button')) {
    button.disabled = busy || button.dataset.locked === 'true';
  }
  $('request-fields').disabled = busy || state.rides.some((item) => ['requested', 'negotiating'].includes(item.status));
}

function setAuthMode(create) {
  registration = create;
  $('show-login').setAttribute('aria-pressed', String(!create));
  $('show-register').setAttribute('aria-pressed', String(create));
  $('registration-fields').hidden = !create;
  $('account-name').disabled = !create;
  $('account-name').required = create;
  $('account-role').disabled = !create;
  $('account-password').autocomplete = create ? 'new-password' : 'current-password';
  $('auth-title').textContent = create ? 'Make your next move.' : 'Welcome back.';
  $('auth-description').textContent = create ? 'Your account, your way to move.' : 'Sign in to pick up where you left off.';
  $('auth-submit').textContent = create ? 'Create account ↗' : 'Sign in ↗';
  const driver = create && $('account-role').value === 'driver';
  $('vehicle-fields').hidden = !driver;
  $('vehicle-fields').disabled = !driver;
  $('vehicle-model').required = driver;
  $('vehicle-plate').required = driver;
  $('page-error').textContent = '';
}

function render() {
  const user = state.user;
  $('loading').hidden = true;
  $('auth-panel').hidden = Boolean(user);
  $('dashboard').hidden = !user;
  $('logout').hidden = !user;
  $('account-identity').textContent = user?.name ?? '';
  if (!user) { updateButtons(); return; }
  const customer = user.role === 'customer';
  const driver = user.role === 'driver';
  const admin = user.role === 'admin';
  $('dashboard-role').textContent = `TAXI AI / ${user.role.toUpperCase()}`;
  $('dashboard-title').textContent = admin ? 'Keep the city moving.' : driver ? 'Your next connection.' : 'Where will today take you?';
  $('dashboard-description').textContent = admin ? 'Review driver applications for the local preview.'
    : driver ? 'Choose an open request and agree a fare with the customer.' : 'Request a journey and agree a fare with your driver.';
  $('customer-panel').hidden = !customer;
  $('driver-panel').hidden = !driver;
  $('ride-dashboard').hidden = admin;
  $('admin-dashboard').hidden = !admin;
  $('available-section').hidden = !driver || user.driver.status !== 'approved';
  $('open-request-note').hidden = !state.rides.some((ride) => ['requested', 'negotiating'].includes(ride.status));
  if (driver) {
    $('driver-status').textContent = user.driver.status.toUpperCase();
    $('driver-vehicle').textContent = `${user.driver.vehicle.model} · ${user.driver.vehicle.plate}`;
    $('driver-guidance').textContent = user.driver.status === 'pending'
      ? 'Your application is waiting for administrator approval. This page will update when it is reviewed.'
      : user.driver.status === 'rejected' ? 'Your application was not approved. Contact the local administrator.'
        : 'You can respond to test requests. One negotiation at a time keeps your availability clear.';
  }
  if (!state.rides.some((ride) => ride.id === selectedId)) {
    selectedId = state.rides.find((ride) => ['requested', 'negotiating'].includes(ride.status))?.id ?? state.rides[0]?.id ?? null;
  }
  const listKey = JSON.stringify({ user, rides: state.rides.map((ride) => [ride.id, ride.version]),
    available: state.available, drivers: state.drivers, selectedId });
  if (listKey !== renderedLists) {
    renderedLists = listKey;
    renderLists();
  }
  renderDetail();
  updateButtons();
}

function renderLists() {
  $('ride-count').textContent = `${state.rides.length} saved`;
  $('ride-list').replaceChildren();
  if (!state.rides.length) $('ride-list').append(element('p', 'Your journeys will appear here. Start with a test request.', 'empty-state'));
  for (const ride of state.rides) {
    const button = element('button', undefined, 'request-row');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(ride.id === selectedId));
    const description = element('span');
    description.append(element('strong', `${ride.pickup.name} → ${ride.destination.name}`),
      element('small', new Date(ride.createdAt).toLocaleString()));
    button.append(description, element('span', statuses[ride.status], 'status-badge'));
    button.addEventListener('click', () => { selectedId = ride.id; render(); });
    $('ride-list').append(button);
  }
  $('available-list').replaceChildren();
  if (!state.available.length) $('available-list').append(element('p', 'No open requests right now. New ones appear automatically.', 'empty-state'));
  const driverBusy = state.rides.some((ride) => ride.status === 'negotiating');
  for (const ride of state.available) {
    const row = element('div', undefined, 'request-row');
    const description = element('div');
    description.append(element('strong', `${ride.pickup.name} → ${ride.destination.name}`),
      element('small', `Sample suggestion ${formatNaira(ride.suggestedFareKobo)}`));
    const button = element('button', 'Start negotiation ↗', 'button button-primary button-small');
    button.type = 'button';
    button.dataset.locked = String(driverBusy);
    button.addEventListener('click', () => runAction(() => rideAction(`/api/rides/${ride.id}/claim`, { expectedVersion: ride.version }), 'Request selected. You or the customer can make the first offer.'));
    row.append(description, button);
    $('available-list').append(row);
  }
  $('driver-applications').replaceChildren();
  if (!state.drivers.length) $('driver-applications').append(element('p', 'Driver applications will appear here after registration.', 'empty-state'));
  for (const driver of state.drivers) {
    const row = element('div', undefined, 'request-row');
    const description = element('div');
    description.append(element('strong', driver.name), element('small', `${driver.vehicle.model} · ${driver.vehicle.plate}`));
    row.append(description);
    if (driver.status === 'pending') {
      const actions = element('div', undefined, 'review-actions');
      for (const [decision, text] of [['approved', 'Approve'], ['rejected', 'Reject']]) {
        const button = element('button', text, `button button-small ${decision === 'approved' ? 'button-primary' : 'button-outline'}`);
        button.type = 'button';
        button.setAttribute('aria-label', `${text} ${driver.name}`);
        button.addEventListener('click', () => runAction(() => api(`/api/admin/drivers/${driver.id}/review`, { method: 'POST', data: { decision } }), `Application ${decision}.`));
        actions.append(button);
      }
      row.append(actions);
    } else row.append(element('span', driver.status.toUpperCase(), 'status-badge'));
    $('driver-applications').append(row);
  }
}

function renderDetail() {
  const ride = selectedRide();
  $('ride-detail').hidden = !ride;
  if (!ride) { detailId = null; renderedDetail = ''; return; }
  const key = `${ride.id}:${ride.version}:${state.user.id}`;
  if (key === renderedDetail) return;
  renderedDetail = key;
  if (detailId !== ride.id) {
    $('live-offer-amount').value = String(ride.suggestedFareKobo / 100);
    detailId = ride.id;
  }
  const offer = ride.negotiation?.currentOffer;
  const agreement = ride.negotiation?.agreement;
  const isDriver = state.user.role === 'driver';
  $('detail-title').textContent = `${ride.pickup.name} → ${ride.destination.name}`;
  $('detail-status').textContent = statuses[ride.status];
  $('detail-person').textContent = isDriver ? `Customer: ${ride.customer.name}`
    : ride.driver ? `Driver: ${ride.driver.name} · ${ride.driver.vehicle.model} · ${ride.driver.vehicle.plate}` : 'An approved driver can respond to your request.';
  $('detail-reference').textContent = `Reference ${ride.id.slice(0, 8).toUpperCase()} · Sample suggestion ${formatNaira(ride.suggestedFareKobo)}`;
  $('live-offer-form').hidden = ride.status !== 'negotiating';
  $('accept-fare').hidden = ride.status !== 'negotiating' || !offer;
  $('accept-fare').textContent = offer ? `Accept ${formatNaira(offer.amountKobo)}` : 'Accept offer';
  // Bind acceptance to the exact version and offer currently displayed. A failed
  // acceptance is never automatically resubmitted against a newer counteroffer.
  $('accept-fare').onclick = () => runAction(() => rideAction(`/api/rides/${ride.id}/accept`, {
    expectedVersion: ride.version, offerId: offer.id }), 'Your fare agreement has been saved.');
  $('cancel-request').hidden = !['requested', 'negotiating'].includes(ride.status);
  $('cancel-request').onclick = () => runAction(() => rideAction(`/api/rides/${ride.id}/cancel`, { expectedVersion: ride.version }), 'Request cancelled.');
  $('agreed-note').hidden = ride.status !== 'agreed';
  if (agreement) {
    $('fare-label').textContent = 'YOUR AGREED FARE';
    $('fare-value').textContent = formatNaira(agreement.amountKobo);
    $('fare-guidance').textContent = 'The offer and acceptance record both participants’ agreement to this exact fare.';
  } else if (ride.status === 'cancelled') {
    $('fare-label').textContent = 'REQUEST CLOSED';
    $('fare-value').textContent = 'Cancelled.';
    $('fare-guidance').textContent = 'No fare was agreed. You can start again with a new request.';
  } else if (offer) {
    const own = offer.proposedBy === state.user.id;
    $('fare-label').textContent = own ? 'YOUR CURRENT OFFER' : `${isDriver ? 'CUSTOMER' : 'DRIVER'}’S CURRENT OFFER`;
    $('fare-value').textContent = formatNaira(offer.amountKobo);
    $('fare-guidance').textContent = own ? 'Waiting for the other person to respond. You can revise your offer.' : 'Accept this exact price or send a counteroffer below.';
  } else {
    $('fare-label').textContent = ride.status === 'requested' ? 'REQUEST SAVED' : 'YOUR FARE, YOUR SAY';
    $('fare-value').textContent = ride.status === 'requested' ? 'Finding your connection.' : 'Make the first offer.';
    $('fare-guidance').textContent = ride.status === 'requested' ? 'Waiting for an approved driver in this local preview. You can refresh or return later.' : 'Start with the sample suggestion or choose your price.';
  }
  const history = ride.negotiation?.offers ?? [];
  $('live-history').hidden = !history.length;
  $('live-offer-history').replaceChildren();
  for (const entry of history) {
    const item = element('li');
    const description = element('span', `${entry.proposedBy === ride.customer.id ? 'Customer' : 'Driver'} offered`);
    const time = element('time', new Date(entry.createdAt).toLocaleTimeString());
    time.dateTime = new Date(entry.createdAt).toISOString();
    description.append(time);
    item.append(description, element('strong', formatNaira(entry.amountKobo)));
    $('live-offer-history').append(item);
  }
}

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const session = await api('/api/session');
    if (state.user?.id !== session.user?.id) {
      state = { ...state, rides: [], available: [], drivers: [] };
      selectedId = null;
      renderedLists = '';
      renderedDetail = '';
      retryKeys.clear();
    }
    state.user = session.user;
    state.csrfToken = session.csrfToken;
    if (session.user?.role === 'admin') {
      state.drivers = (await api('/api/admin/drivers')).drivers;
    } else if (session.user) {
      const data = await api('/api/rides');
      state.rides = data.rides;
      state.available = data.available;
    }
    $('sync-status').textContent = 'Up to date · refreshes every 3s';
    render();
  })();
  try { await refreshing; }
  finally { refreshing = null; }
}

async function rideAction(path, data) {
  const fingerprint = `${path}:${JSON.stringify(data)}`;
  const key = retryKeys.get(fingerprint) ?? crypto.randomUUID();
  retryKeys.set(fingerprint, key);
  try {
    const result = await api(path, { method: 'POST', data, key });
    retryKeys.delete(fingerprint);
    selectedId = result.ride.id;
    return result;
  } catch (error) {
    if (error.status && error.status < 500) retryKeys.delete(fingerprint);
    throw error;
  }
}

async function runAction(action, message) {
  if (busy) return;
  busy = true;
  updateButtons();
  $('page-error').textContent = '';
  $('page-notice').textContent = '';
  try {
    if (refreshing) await refreshing.catch(() => {});
    await action();
    if (message) $('page-notice').textContent = message;
    try { await refresh(); }
    catch { $('page-error').textContent = 'Your action was saved, but the latest view could not load. Click Refresh.'; }
  } catch (error) {
    $('page-error').textContent = error.message;
    if (error.status === 401 || error.status === 403 || error.status === 409) {
      try { await refresh(); } catch { /* Keep the original actionable error. */ }
    }
  } finally { busy = false; updateButtons(); }
}

async function poll() {
  try {
    if (!busy && !document.hidden) await refresh();
  } catch {
    $('sync-status').textContent = 'Connection lost · use Refresh to retry';
    if (!$('loading').hidden) {
      $('loading').hidden = true;
      $('auth-panel').hidden = false;
      $('page-error').textContent = 'Unable to connect. Check that Taxi Ai is running, then refresh this page.';
    }
  }
}

$('show-login').addEventListener('click', () => setAuthMode(false));
$('show-register').addEventListener('click', () => setAuthMode(true));
$('account-role').addEventListener('change', () => setAuthMode(registration));
$('auth-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = { email: $('account-email').value, password: $('account-password').value };
  if (registration) {
    Object.assign(data, { name: $('account-name').value, role: $('account-role').value });
    if (data.role === 'driver') data.vehicle = { model: $('vehicle-model').value, plate: $('vehicle-plate').value };
  }
  const path = registration ? '/api/auth/register' : '/api/auth/login';
  runAction(async () => {
    const result = await api(path, { method: 'POST', data });
    state.user = result.user;
    state.csrfToken = result.csrfToken;
    $('auth-form').reset();
    setAuthMode(false);
    renderedLists = '';
    renderedDetail = '';
  });
});
$('logout').addEventListener('click', () => runAction(async () => {
  await api('/api/auth/logout', { method: 'POST' });
  state = { user: null, csrfToken: null, rides: [], available: [], drivers: [] };
  retryKeys.clear(); selectedId = null; renderedLists = ''; renderedDetail = '';
  render();
}));
$('refresh').addEventListener('click', () => runAction(() => refresh()));

for (const id of ['request-pickup', 'request-destination']) {
  for (const area of DEMO_AREAS) {
    const option = element('option', area.name);
    option.value = area.id;
    $(id).append(option);
  }
  $(id).addEventListener('change', updateQuote);
}
$('request-pickup').value = 'wuse-ii';
$('request-destination').value = 'maitama';
function updateQuote() {
  try { $('request-quote').textContent = formatNaira(createDemoQuote($('request-pickup').value, $('request-destination').value).suggestedFareKobo); }
  catch { $('request-quote').textContent = 'Choose different areas'; }
}
$('request-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = { pickupId: $('request-pickup').value, destinationId: $('request-destination').value };
  runAction(() => rideAction('/api/rides', data), 'Your test request is saved and available to approved drivers.');
});
$('live-offer-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const ride = selectedRide();
  if (!ride) return;
  let amountKobo;
  try { amountKobo = nairaToKobo($('live-offer-amount').value); }
  catch (error) { $('page-error').textContent = error.message; return; }
  const data = { expectedVersion: ride.version, amountKobo };
  runAction(() => rideAction(`/api/rides/${ride.id}/offers`, data), 'Offer sent. The other person must accept it.');
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) poll();
});
setInterval(updateButtons, 1000);
setInterval(poll, 3000);
setAuthMode(false);
updateQuote();
poll();
