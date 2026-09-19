import { DEMO_AREAS, createDemoQuote, formatNaira, nairaToKobo } from '/shared/demo-booking.mjs';
import { $, element } from './dom.mjs';
import { renderChatReports } from './chat-reports-view.mjs';
import { RIDE_STATUS_LABELS as statuses, isActiveRide } from '/shared/trip-lifecycle.mjs';
import { searchRadius } from '/shared/matching.mjs';
import { createTripView } from './trip-view.mjs';


/** DOM rendering and UI events. No network, session storage or backend imports. */
export function createDashboardView({ onCommand, onReview, onReportReview, onSelectionChange, onHistory, serverNow }) {
  let state = { user: null, rides: [], available: [], drivers: [] };
  let selectedId = null, detailId = null;
  let renderedLists = '', renderedDetail = '';
  let busy = false;
  const tripView = createTripView({ onCommand, serverNow });
  function selectedRide() { return state.rides.find((ride) => ride.id === selectedId) ?? state.history?.find((ride) => ride.id === selectedId); }

  function updateButtons() {
    const ride = selectedRide();
    const offer = ride?.negotiation?.currentOffer;
    const remaining = offer ? offer.expiresAt - serverNow() : 0;
    const canAccept = ride?.status === 'negotiating' && offer && offer.proposedBy !== state.user?.id && remaining > 0;
    tripView.tick();
    $('history-more').dataset.locked = String(!state.historyCursor);
    $('accept-fare').dataset.locked = String(!canAccept);
    $('fare-expiry').textContent = ride?.status === 'negotiating' && offer
      ? remaining > 0 ? `Offer expires in ${Math.ceil(remaining / 1000)} seconds.` : 'This offer expired. Send a new offer to continue.' : '';
    $('matching-status').textContent = ride?.status === 'requested' && ride.matching
      ? serverNow() >= ride.matching.expiresAt ? 'Search window ended. Refreshing the request status…'
        : `${ride.matching.mode === 'gps' ? `Searching within ${searchRadius(ride.createdAt, serverNow()) / 1000} km of pickup` : 'Searching for drivers in the same sample area'} · ${Math.ceil((ride.matching.expiresAt - serverNow()) / 1000)} seconds remaining.` : '';
    for (const button of document.querySelectorAll('[data-request-expires]')) {
      button.dataset.locked = String(!state.availabilityOnline || Number(button.dataset.requestExpires) <= serverNow()
        || state.rides.some((item) => isActiveRide(item.status)));
    }
    for (const button of document.querySelectorAll('button')) {
      if (button.closest('#calls-panel, #location-planner, #location-tracking, #availability-panel, #payment-panel, #earnings-panel, #payments-admin-panel')) continue; // Feature controllers own their controls.
      button.disabled = busy || button.dataset.locked === 'true';
    }
    $('request-fields').disabled = busy || state.rides.some((item) => isActiveRide(item.status));
  }

  function render(nextState = state) {
    state = nextState;
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
    $('dashboard-description').textContent = admin ? 'Review driver applications for the development preview.'
      : driver ? 'Go online to find nearby requests and agree a fare with the customer.' : 'Request a journey and agree a fare with your driver.';
    $('customer-panel').hidden = !customer;
    $('request-form').hidden = !state.sampleMatchingEnabled;
    $('sample-disabled-note').hidden = Boolean(state.sampleMatchingEnabled);
    $('driver-panel').hidden = !driver;
    $('ride-dashboard').hidden = admin;
    $('admin-dashboard').hidden = !admin;
    $('chat-reports-panel').hidden = !admin;
    $('available-section').hidden = !driver || user.driver.status !== 'approved';
    $('open-request-note').hidden = !state.rides.some((ride) => isActiveRide(ride.status));
    if (driver) {
      $('driver-status').textContent = user.driver.status.toUpperCase();
      $('driver-vehicle').textContent = `${user.driver.vehicle.model} · ${user.driver.vehicle.plate}`;
      $('driver-guidance').textContent = user.driver.status === 'pending'
        ? 'Your application is waiting for administrator approval. This page will update when it is reviewed.'
        : user.driver.status === 'rejected' ? 'Your application was not approved. Contact the test administrator.'
          : 'Choose Go online below when you are ready for a request. Finish your current negotiation or trip before taking another.';
    }
    if (!selectedRide()) {
      selectedId = state.rides.find((ride) => isActiveRide(ride.status))?.id ?? state.rides[0]?.id ?? null;
    }
    const listKey = JSON.stringify({ user, rides: state.rides.map((ride) => [ride.id, ride.version]),
      available: state.available, drivers: state.drivers, reports: state.reports, unread: state.chatUnread, selectedId,
      history: state.history?.map((ride) => [ride.id, ride.version]), historyCursor: state.historyCursor });
    if (listKey !== renderedLists) {
      renderedLists = listKey;
      renderLists();
    }
    renderDetail();
    updateButtons();
  }

  function renderLists() {
    const currentRides = state.rides.filter((ride) => !['completed', 'cancelled', 'expired'].includes(ride.status));
    $('ride-count').textContent = `${currentRides.length} current`;
    $('ride-list').replaceChildren();
    $('history-list').replaceChildren();
    if (!currentRides.length) $('ride-list').append(element('p', 'No current requests. Start with a test request.', 'empty-state'));
    if (!state.history?.length) $('history-list').append(element('p', 'Completed, cancelled and expired trips will appear here.', 'empty-state'));
    $('history-more').hidden = !state.historyCursor;
    $('history-count').textContent = `${state.history?.length ?? 0} loaded`;
    for (const ride of [...currentRides, ...(state.history ?? [])]) {
      const button = element('button', undefined, 'request-row');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(ride.id === selectedId));
      const description = element('span');
      description.append(element('strong', `${ride.pickup.name} → ${ride.destination.name}`),
        element('small', new Date(ride.createdAt).toLocaleString()));
      const unread = state.chatUnread?.[ride.id] ?? 0;
      if (unread) description.append(element('small', `${unread} unread message${unread === 1 ? '' : 's'}`, 'chat-unread-count'));
      button.append(description, element('span', statuses[ride.status], 'status-badge'));
      button.addEventListener('click', () => { selectedId = ride.id; render(); onSelectionChange(selectedRide()); });
      $(['completed', 'cancelled', 'expired'].includes(ride.status) ? 'history-list' : 'ride-list').append(button);
    }
    $('available-list').replaceChildren();
    if (!state.available.length) $('available-list').append(element('p', 'Nearby requests appear while you are online. Local sample mode matches requests from your selected sample area.', 'empty-state'));
    const driverBusy = state.rides.some((ride) => isActiveRide(ride.status));
    for (const ride of state.available) {
      const row = element('div', undefined, 'request-row');
      const description = element('div');
      description.append(element('strong', `${ride.pickup.name} → ${ride.destination.name}`),
        element('small', `${ride.hasRoute ? 'Route suggestion' : 'Sample suggestion'} ${formatNaira(ride.suggestedFareKobo)}`));
      description.append(element('small', ride.hasRoute ? `Within about ${Math.max(1, ride.approximateDistanceKm)} km in a straight line · driving time varies` : 'Local sample-area match'));
      const button = element('button', 'Start negotiation ↗', 'button button-primary button-small');
      button.type = 'button';
      button.dataset.locked = String(driverBusy || !state.availabilityOnline || ride.expiresAt <= serverNow());
      button.dataset.requestExpires = String(ride.expiresAt);
      button.addEventListener('click', () => onCommand(`/api/rides/${ride.id}/claim`, { expectedVersion: ride.version }, 'Request selected. You or the customer can make the first offer.'));
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
          button.addEventListener('click', () => onReview(driver.id, decision, `Application ${decision}.`));
          actions.append(button);
        }
        row.append(actions);
      } else row.append(element('span', driver.status.toUpperCase(), 'status-badge'));
      $('driver-applications').append(row);
    }
    renderChatReports(state.reports ?? [], onReportReview);
  }

  function renderDetail() {
    const ride = selectedRide();
    tripView.render(ride, state.user);
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
      : ride.driver ? `Driver: ${ride.driver.name} · ${ride.driver.vehicle.model} · ${ride.driver.vehicle.plate}` : ride.status === 'expired' ? 'No driver selected this request before it expired.' : 'Looking for an available driver near your pickup.';
    $('detail-reference').textContent = `Reference ${ride.id.slice(0, 8).toUpperCase()} · ${ride.route ? 'Route suggestion' : 'Sample suggestion'} ${formatNaira(ride.suggestedFareKobo)}`;
    $('live-offer-form').hidden = ride.status !== 'negotiating';
    $('accept-fare').hidden = ride.status !== 'negotiating' || !offer;
    $('accept-fare').textContent = offer ? `Accept ${formatNaira(offer.amountKobo)}` : 'Accept offer';
    // Bind acceptance to the exact version and offer currently displayed. A failed
    // acceptance is never automatically resubmitted against a newer counteroffer.
    $('accept-fare').onclick = () => onCommand(`/api/rides/${ride.id}/accept`, {
      expectedVersion: ride.version, offerId: offer.id }, 'Your fare agreement has been saved.');
    $('agreed-note').hidden = ride.status !== 'agreed';
    if (agreement) {
      $('fare-label').textContent = 'YOUR AGREED FARE';
      $('fare-value').textContent = formatNaira(agreement.amountKobo);
      $('fare-guidance').textContent = 'The offer and acceptance record both participants’ agreement to this exact fare.';
    } else if (['cancelled', 'expired'].includes(ride.status)) {
      $('fare-label').textContent = 'REQUEST CLOSED';
      $('fare-value').textContent = ride.status === 'expired' ? 'No driver found.' : 'Cancelled.';
      $('fare-guidance').textContent = ride.status === 'expired' ? 'The five-minute search has ended. Submit a new request above when you are ready.' : 'No fare was agreed. You can start again with a new request.';
    } else if (offer) {
      const own = offer.proposedBy === state.user.id;
      $('fare-label').textContent = own ? 'YOUR CURRENT OFFER' : `${isDriver ? 'CUSTOMER' : 'DRIVER'}’S CURRENT OFFER`;
      $('fare-value').textContent = formatNaira(offer.amountKobo);
      $('fare-guidance').textContent = own ? 'Waiting for the other person to respond. You can revise your offer.' : 'Accept this exact price or send a counteroffer below.';
    } else {
      $('fare-label').textContent = ride.status === 'requested' ? 'REQUEST SAVED' : 'YOUR FARE, YOUR SAY';
      $('fare-value').textContent = ride.status === 'requested' ? 'Finding your connection.' : 'Make the first offer.';
      $('fare-guidance').textContent = ride.status === 'requested' ? 'We are looking for an online driver. Unclaimed requests close after five minutes.' : 'Start with the suggestion or choose your price.';
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
    onCommand('/api/rides', data, 'Your test request is saved. Looking for online drivers in the same sample area.');
  });
  $('live-offer-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const ride = selectedRide();
    if (!ride) return;
    let amountKobo;
    try { amountKobo = nairaToKobo($('live-offer-amount').value); }
    catch (error) { $('page-error').textContent = error.message; return; }
    const data = { expectedVersion: ride.version, amountKobo };
    onCommand(`/api/rides/${ride.id}/offers`, data, 'Offer sent. The other person must accept it.');
  });

  updateQuote();
  $('history-refresh').addEventListener('click', () => onHistory(null));
  $('history-more').addEventListener('click', () => { if (state.historyCursor) onHistory(state.historyCursor); });
  return Object.freeze({
    render,
    tick: updateButtons,
    setBusy(value) { busy = value; tripView.setBusy(value); updateButtons(); },
    select(id) { selectedId = id; },
    selected: selectedRide,
    reset() {
      selectedId = null; detailId = null; renderedLists = ''; renderedDetail = '';
      $('chat-reports-list').replaceChildren();
      $('ride-list').replaceChildren(); $('history-list').replaceChildren(); tripView.reset();
    },
  });
}
