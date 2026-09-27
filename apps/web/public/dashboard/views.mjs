import { categoryFare, deliveryDetails, transportCategory, supportsParcelCategory, parcelLoadLimit } from '/shared/transport-categories.mjs';
import { vehicleCategory } from '/shared/vehicle-categories.mjs';
import { DRIVER_APPLICATION_LABELS } from '/shared/driver-onboarding.mjs';
import { DEMO_AREAS, matchSampleArea, createDemoQuote, formatNaira, nairaToKobo } from '/shared/demo-booking.mjs';
import { $, element } from './dom.mjs';
import { renderChatReports } from './chat-reports-view.mjs';
import { RIDE_STATUS_LABELS as statuses, isActiveRide } from '/shared/trip-lifecycle.mjs';
import { searchRadius } from '/shared/matching.mjs';
import { MATCH_REASON_LABELS } from '/shared/smart-matching.mjs';
import { createTripView } from './trip-view.mjs';
import { renderVehicleCard } from './vehicle-card.mjs';
import { createVehicleCategoryPicker } from './vehicle-categories.mjs';
import { passengerDetails } from '/shared/guest-rides.mjs';


/** DOM rendering and UI events. No network, session storage or backend imports. */
export function createDashboardView({ onCommand, onReview, onReportReview, onSelectionChange, onHistory, serverNow, onCategoryChange = () => {}, onVehicleMismatch = () => {}, onEditVehicle = () => {} }) {
  let state = { user: null, rides: [], available: [], drivers: [] };
  let selectedId = null, detailId = null;
  let renderedLists = '', renderedDetail = '';
  let offerCountdowns = [];
  let busy = false;
  let passengerCategory = 'standard', passengerAccount = null;
  const query = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);
  let courier = query.get('service') === 'courier';
  const showLocalSample = query.get('devSample') === '1';
  let initialCategory = query.get('category');
  const tripView = createTripView({ onCommand, serverNow, onVehicleMismatch });
  const categories = createVehicleCategoryPicker($('account-vehicle-categories'), { onSelect() { updateCategoryVisibility(); updateButtons(); } });
  function isDelivery() { return courier || transportCategory(categories.selected().id).service === 'delivery'; }
  function clearDelivery() { for (const id of ['delivery-description', 'delivery-weight', 'delivery-recipient', 'delivery-pickup', 'delivery-dropoff']) $(id).value = ''; }
  function updateCategoryVisibility() {
    const customer = state.user?.role === 'customer';
    $('vehicle-categories-panel').hidden = !customer;
    $('standard-ride-planner').hidden = !customer || !categories.selected().ridePreview;
    $('customer-panel').hidden = !customer || !showLocalSample;
    const category = categories.selected();
    if (passengerCategory !== category.id) {
      if (transportCategory(passengerCategory)?.service !== transportCategory(category.id)?.service) clearPassenger();
      passengerCategory = category.id;
    }
    $('passenger-panel').hidden = !customer || isDelivery();
    $('delivery-details-form').hidden = !customer || !isDelivery();
    const maxLoadKg = isDelivery() ? parcelLoadLimit(category.id) : null;
    $('delivery-weight').max = String(maxLoadKg ?? '');
    $('booking-service-ride').setAttribute('aria-pressed', String(!isDelivery()));
    $('booking-service-courier').setAttribute('aria-pressed', String(isDelivery()));
    $('booking-service-note').textContent = isDelivery() ? 'Choose a car, motorcycle, van or truck, then add your parcel and recipient details.' : 'Choose a vehicle for your passenger journey.';
    $('delivery-load-hint').textContent = maxLoadKg ? `${category.id === 'standard' ? 'Car' : category.name} parcel limit: ${maxLoadKg} kg. Matching also respects the driver’s approved load capacity.` : '';
    $('request-submit').textContent = `Request a test ${isDelivery() ? 'delivery' : 'ride'}`;
    if (customer) {
      $('dashboard-title').textContent = isDelivery() ? 'Send a parcel across Nigeria.' : 'Where will today take you?';
      $('dashboard-description').textContent = isDelivery() ? 'Choose pickup and delivery locations, add parcel details and invite your recipient to track it.' : 'Request a journey and agree a fare with your driver.';
    }
    onCategoryChange(category.id); updateQuote();
  }
  function selectedRide() { return state.rides.find((ride) => ride.id === selectedId) ?? state.history?.find((ride) => ride.id === selectedId); }

  function updateButtons() {
    categories.setDisabled(busy);
    $('booking-service-ride').disabled = $('booking-service-courier').disabled = busy;
    const ride = selectedRide();
    const offer = ride?.negotiation?.currentOffer;
    const remaining = offer ? offer.expiresAt - serverNow() : 0;
    const canAccept = ride?.status === 'negotiating' && offer && offer.proposedBy !== state.user?.id && remaining > 0;
    tripView.tick();
    $('history-more').dataset.locked = String(!state.historyCursor);
    $('driver-edit-vehicle').dataset.locked = String(state.user?.role !== 'driver');
    $('accept-fare').dataset.locked = String(!canAccept);
    $('fare-expiry').textContent = ride?.status === 'negotiating' && offer
      ? remaining > 0 ? `Offer expires in ${Math.ceil(remaining / 1000)} seconds.` : 'This offer expired. Send a new offer to continue.' : '';
    $('matching-status').textContent = ride?.status === 'requested' && ride.matching
      ? serverNow() >= ride.matching.expiresAt ? 'Search window ended. Refreshing the request status…'
        : `${ride.matching.mode === 'gps' ? `Searching within ${searchRadius(ride.createdAt, serverNow()) / 1000} km of pickup` : 'Searching for drivers in the same sample area'} · ${Math.ceil((ride.matching.expiresAt - serverNow()) / 1000)} seconds remaining.` : '';
    for (const button of document.querySelectorAll('[data-request-expires]')) {
      button.dataset.locked = String(!state.availabilityOnline || Number(button.dataset.requestExpires) <= serverNow()
        || (state.activeElsewhere?.length > 0 || state.rides.some((item) => isActiveRide(item.status))));
    }
    for (const { node, expiresAt } of offerCountdowns) {
      const seconds = Math.ceil((expiresAt - serverNow()) / 1000);
      node.textContent = seconds > 0 ? `Respond within ${seconds} seconds.` : 'Offer expired. Waiting for the next request.';
    }
    for (const button of document.querySelectorAll('button')) {
      if (button.closest('#parcel-link-panel, #guest-link-panel, #vehicle-categories-panel, #google-auth, #account-modes, #calls-panel, #location-planner, #location-tracking, #availability-panel, #payment-panel, #earnings-panel, #payments-admin-panel, #onboarding-panel, #trusted-contacts-panel, #safety-panel, #safety-admin-panel')) continue; // Feature controllers own their controls.
      button.disabled = busy || button.dataset.locked === 'true';
    }
    $('delivery-details-fields').disabled = busy || state.user?.role !== 'customer' || !isDelivery()
      || state.activeElsewhere?.length > 0 || state.rides.some((item) => isActiveRide(item.status));
    $('request-fields').disabled = busy || (state.activeElsewhere?.length > 0 || state.rides.some((item) => isActiveRide(item.status)));
    $('passenger-fields').disabled = busy || state.user?.role !== 'customer' || isDelivery()
      || state.activeElsewhere?.length > 0 || state.rides.some((item) => isActiveRide(item.status));
  }

  function render(nextState = state) {
    state = nextState;
    const user = state.user;
    const account = user ? `${user.id}:${user.role}` : null;
    if (account !== passengerAccount) { clearPassenger(); clearDelivery(); passengerAccount = account; }
    if (courier) categories.allow(['standard', 'motorcycle', 'van', 'truck']);
    if (user?.role === 'customer' && initialCategory) { const id = initialCategory; initialCategory = null; categories.select(id); }
    $('loading').hidden = true;
    $('auth-panel').hidden = Boolean(user);
    $('dashboard').hidden = !user;
    $('logout').hidden = !user;
    $('account-identity').textContent = user?.name ?? '';
    updateCategoryVisibility();
    if (!user) { updateButtons(); return; }
    const driver = user.role === 'driver';
    const admin = user.role === 'admin';
    $('dashboard-role').textContent = `TAXI AI / ${driver ? 'WORK' : user.role.toUpperCase()}`;
    if (admin || driver) {
      $('dashboard-title').textContent = admin ? 'Keep the city moving.' : 'Your next connection.';
      $('dashboard-description').textContent = admin ? 'Review driver applications for the development preview.'
        : 'Go online to find nearby requests and agree a fare with the customer.';
    }
    $('request-form').hidden = !showLocalSample || !state.sampleMatchingEnabled;
    $('sample-disabled-note').hidden = !showLocalSample || Boolean(state.sampleMatchingEnabled);
    $('driver-panel').hidden = !driver;
    $('ride-dashboard').hidden = admin;
    $('admin-dashboard').hidden = !admin;
    $('chat-reports-panel').hidden = !admin;
    $('available-section').hidden = !driver || !user.driver.eligibility?.eligible || user.driver.status !== 'approved';
    $('available-title').textContent = state.dispatchMode && state.dispatchMode !== 'legacy' ? 'Ride offers' : 'Nearby requests';
    $('open-request-note').hidden = !(state.activeElsewhere?.length > 0 || state.rides.some((ride) => isActiveRide(ride.status)));
    renderVehicleCard($('driver-vehicle-card'), driver ? user.driver.vehicle : null, { label: 'REGISTERED VEHICLE', compact: true });
    if (driver) {
      $('driver-status').textContent = DRIVER_APPLICATION_LABELS[user.driver.eligibility?.reviewStatus] ?? user.driver.status.toUpperCase();
      $('driver-vehicle').textContent = `${user.driver.vehicle.model} · ${user.driver.vehicle.plate}`;
      $('driver-guidance').textContent = user.driver.eligibility?.eligible
        ? 'Choose Go online when you are ready for a request.'
        : 'Complete or update your driver application above. Review approval and current documents are required for new rides.';
    }
    if (!selectedRide()) {
      selectedId = state.rides.find((ride) => isActiveRide(ride.status))?.id ?? state.rides[0]?.id ?? null;
    }
    const listKey = JSON.stringify({ user, rides: state.rides.map((ride) => [ride.id, ride.version]),
      available: state.available, dispatchMode: state.dispatchMode, drivers: state.drivers, reports: state.reports, unread: state.chatUnread, selectedId,
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
        element('small', `${vehicleCategory(ride.vehicleCategory ?? 'standard')?.name} · ${new Date(ride.createdAt).toLocaleString()}`));
      if (ride.passenger?.kind === 'guest') description.append(element('small', `Passenger: ${ride.passenger.name} · Booked by ${ride.customer.name}`));
      const unread = state.chatUnread?.[ride.id] ?? 0;
      if (unread) description.append(element('small', `${unread} unread message${unread === 1 ? '' : 's'}`, 'chat-unread-count'));
      button.append(description, element('span', statuses[ride.status], 'status-badge'));
      button.addEventListener('click', () => { selectedId = ride.id; render(); onSelectionChange(selectedRide()); });
      $(['completed', 'cancelled', 'expired'].includes(ride.status) ? 'history-list' : 'ride-list').append(button);
    }
    $('available-list').replaceChildren();
    offerCountdowns = [];
    const timedOffers = state.dispatchMode && state.dispatchMode !== 'legacy';
    if (!state.available.length) $('available-list').append(element('p', timedOffers
      ? 'Timed ride offers appear while you are online. Review an offer, then accept to negotiate the fare.'
      : 'Nearby requests appear while you are online. Local sample mode matches requests from your selected sample area.', 'empty-state'));
    const driverBusy = (state.activeElsewhere?.length > 0 || state.rides.some((ride) => isActiveRide(ride.status)));
    if (state.available.some((ride) => ride.recommendation && !ride.offer)) $('available-list').append(element('p', 'Eligible requests are ordered by pickup distance and customer waiting time.', 'empty-state'));
    for (const ride of state.available) {
      const row = element('div', undefined, ride.offer ? 'request-row dispatch-offer-row' : 'request-row');
      const description = element('div');
      const offer = ride.offer, expiresAt = Math.min(ride.expiresAt, offer?.expiresAt ?? ride.expiresAt);
      if (offer) description.append(element('strong', 'Ride offer'));
      description.append(element('strong', `${ride.pickup.name} → ${ride.destination.name}`),
        element('small', `${vehicleCategory(ride.vehicleCategory ?? 'standard')?.name} · ${ride.hasRoute ? 'Route suggestion' : 'Sample suggestion'} ${formatNaira(ride.suggestedFareKobo)}`));
      if (offer?.etaSource === 'road') description.append(element('small', `About ${offer.pickupEtaMinutes} min to pickup · road estimate`));
      else {
        if (offer?.etaSource === 'distance_fallback') description.append(element('small', 'Road estimate unavailable'));
        description.append(element('small', offer?.etaSource === 'sample' || !ride.hasRoute ? 'Local sample-area match · no road estimate'
          : `Within about ${Math.max(1, ride.approximateDistanceKm)} km in a straight line · driving time varies`));
      }
      if (ride.recommendation && !offer) description.append(element('small', ride.recommendation.reasons.map((reason) => MATCH_REASON_LABELS[reason]).filter(Boolean).join(' · ')));
      if (offer) {
        const countdown = element('small'); offerCountdowns.push({ node: countdown, expiresAt });
        description.append(countdown, element('small', 'Accepting opens fare negotiation. Both sides must agree before booking.'));
      }
      const canRespond = () => !busy && state.availabilityOnline && expiresAt > serverNow()
        && !state.activeElsewhere?.length && !state.rides.some((item) => isActiveRide(item.status))
        && state.available.some((item) => item.id === ride.id && item.version === ride.version && item.offer?.id === offer?.id);
      const button = element('button', offer ? 'Accept and negotiate' : 'Start negotiation ↗', 'button button-primary button-small');
      button.type = 'button';
      button.dataset.locked = String(driverBusy || !state.availabilityOnline || expiresAt <= serverNow());
      button.dataset.requestExpires = String(expiresAt);
      button.addEventListener('click', () => {
        if (canRespond()) onCommand(`/api/rides/${ride.id}/claim`, { expectedVersion: ride.version, ...(offer ? { offerId: offer.id } : {}) }, 'Request selected. You or the customer can make the first fare offer.');
      });
      row.append(description, button);
      if (offer) {
        const decline = element('button', 'Decline offer', 'button button-small');
        decline.type = 'button'; decline.dataset.requestExpires = String(expiresAt);
        decline.addEventListener('click', () => { if (canRespond()) onCommand(`/api/dispatch/offers/${offer.id}/decline`, {}, 'Offer declined. You are still available for another request.'); });
        row.append(decline);
      }
      $('available-list').append(row);
    }
    $('driver-applications').replaceChildren();
    if (!state.drivers.length) $('driver-applications').append(element('p', 'Driver applications will appear here after registration.', 'empty-state'));
    for (const driver of state.drivers) {
      const row = element('div', undefined, 'request-row');
      const description = element('div');
      description.append(element('strong', driver.name), element('small', `${driver.vehicle.model} · ${driver.vehicle.plate}`));
      row.append(description);
      row.append(element('span', DRIVER_APPLICATION_LABELS[driver.applicationStatus] ?? driver.status, 'status-badge'));
      const review = element('button', 'Review application', 'button button-outline button-small');
      review.type = 'button'; review.addEventListener('click', () => onReview(driver.id)); row.append(review);
      $('driver-applications').append(row);
    }
    renderChatReports(state.reports ?? [], onReportReview);
  }

  function renderDetail() {
    const ride = selectedRide();
    tripView.render(ride, state.user);
    $('ride-detail').hidden = !ride;
    renderVehicleCard($('detail-vehicle-card'), ride?.driver?.vehicle, { label: 'YOUR JOURNEY’S VEHICLE' });
    if (!ride) { detailId = null; renderedDetail = ''; $('detail-passenger').textContent = ''; $('detail-passenger').hidden = true; return; }
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
    $('detail-status').textContent = `${vehicleCategory(ride.vehicleCategory ?? 'standard')?.name} · ${ride.delivery && ride.status === 'completed' ? 'Delivered' : statuses[ride.status]}`;
    $('detail-delivery').hidden = !ride.delivery;
    $('detail-delivery').textContent = ride.delivery ? `${ride.delivery.description} · ${ride.delivery.weightKg} kg · Recipient: ${ride.delivery.recipientName}. Pickup: ${ride.delivery.pickupInstructions || 'No instructions'}. Drop-off: ${ride.delivery.dropoffInstructions || 'No instructions'}.` : '';
    $('detail-person').textContent = isDriver ? `Customer: ${ride.customer.name}`
      : ride.driver ? `Driver: ${ride.driver.name} · ${ride.driver.vehicle.model} · ${ride.driver.vehicle.plate}` : ride.status === 'expired' ? 'No driver selected this request before it expired.' : 'Looking for an available driver near your pickup.';
    const guest = ride.passenger?.kind === 'guest';
    $('detail-passenger').hidden = !guest;
    $('detail-passenger').textContent = guest ? `Passenger: ${ride.passenger.name} · Booked by: ${ride.customer.name}${ride.customer.id === state.user.id && ride.passenger.phone ? ` · Private contact: ${ride.passenger.phone}` : ''}. Fare, chat and payment are managed by the person booking.` : '';
    $('detail-reference').textContent = `Reference ${ride.id.slice(0, 8).toUpperCase()} · ${ride.route ? 'Route suggestion' : 'Sample suggestion'} ${formatNaira(ride.suggestedFareKobo)}`;
    $('live-offer-form').hidden = ride.status !== 'negotiating';
    const negotiating = ride.status === 'negotiating' && Boolean(ride.driver);
    $('fare-negotiation-guide').hidden = !negotiating;
    const peerName = isDriver ? ride.customer.name : ride.driver?.name;
    $('fare-negotiation-title').textContent = negotiating ? `Agree your fare with ${peerName}.` : 'Talk before accepting.';
    $('fare-negotiation-copy').textContent = negotiating
      ? `Use Taxi Ai chat or an in-app audio call to discuss the price with ${peerName}. The suggested fare is only a starting point; only an exact offer accepted by the other person creates a fare agreement.`
      : '';
    $('fare-open-chat').textContent = isDriver ? 'Chat with customer' : 'Chat with driver';
    $('fare-open-call').textContent = isDriver ? 'Call customer in app' : 'Call driver in app';
    $('accept-fare').hidden = ride.status !== 'negotiating' || !offer;
    $('accept-fare').textContent = offer ? `Accept exact fare · ${formatNaira(offer.amountKobo)}` : 'Accept exact fare';
    // Bind acceptance to the exact version and offer currently displayed. A failed
    // acceptance is never automatically resubmitted against a newer counteroffer.
    $('accept-fare').onclick = () => onCommand(`/api/rides/${ride.id}/accept`, {
      expectedVersion: ride.version, offerId: offer.id }, 'Your fare agreement has been saved.');
    $('agreed-note').hidden = ride.status !== 'agreed';
    if (agreement) {
      $('fare-label').textContent = 'YOUR AGREED FARE';
      $('fare-value').textContent = formatNaira(agreement.amountKobo);
      $('fare-guidance').textContent = 'Both participants explicitly agreed to this exact fare. The customer can now confirm the ride.';
    } else if (['cancelled', 'expired'].includes(ride.status)) {
      $('fare-label').textContent = 'REQUEST CLOSED';
      $('fare-value').textContent = ride.status === 'expired' ? 'No driver found.' : 'Cancelled.';
      $('fare-guidance').textContent = ride.status === 'expired' ? 'The five-minute search has ended. Submit a new request above when you are ready.' : 'No fare was agreed. You can start again with a new request.';
    } else if (offer) {
      const own = offer.proposedBy === state.user.id;
      $('fare-label').textContent = own ? 'YOUR CURRENT OFFER' : `${isDriver ? 'CUSTOMER' : 'DRIVER'}’S CURRENT OFFER`;
      $('fare-value').textContent = formatNaira(offer.amountKobo);
      $('fare-guidance').textContent = own
        ? 'Your exact offer is waiting for the other person. Continue in chat or call if you need to discuss it.'
        : 'Review this exact offer after your chat or call. Accept it only if you agree, or send a counteroffer.';
    } else {
      $('fare-label').textContent = ride.status === 'requested' ? 'FINDING A DRIVER' : 'AGREE YOUR FARE';
      $('fare-value').textContent = ride.status === 'requested' ? formatNaira(ride.suggestedFareKobo) + ' suggested' : 'Discuss, then make an offer.';
      $('fare-guidance').textContent = ride.status === 'requested'
        ? 'This suggested fare is only a starting point. When a driver joins, use chat or an in-app call to agree the price before booking.'
        : 'Use chat or an in-app call first, then send the exact price you agree to. The other person must explicitly accept that offer.';
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

  const currentPickupId = 'wuse-ii';
  $('request-pickup').value = currentPickupId;
  $('request-destination').addEventListener('input', updateQuote);
  const selectedSampleDestination = () => {
    const area = matchSampleArea(DEMO_AREAS, $('request-destination').value);
    return area?.id !== currentPickupId ? area : null;
  };
  function updateQuote() {
    const destination = selectedSampleDestination();
    $('request-quote').textContent = destination
      ? formatNaira(categoryFare(createDemoQuote(currentPickupId, destination.id).suggestedFareKobo, categories.selected().id))
      : 'Type a suggested area';
  }
  function requestOptions() {
    const vehicleCategory = categories.selected().id;
    if (!isDelivery()) return { vehicleCategory,
      passenger: passengerDetails($('passenger-kind').value === 'guest' ? { kind: 'guest', name: $('passenger-name').value,
        phone: $('passenger-phone').value, consent: $('passenger-consent').checked === true } : { kind: 'self' }, vehicleCategory) };
    const delivery = deliveryDetails(vehicleCategory, { description: $('delivery-description').value, weightKg: Number($('delivery-weight').value),
      recipientName: $('delivery-recipient').value, pickupInstructions: $('delivery-pickup').value, dropoffInstructions: $('delivery-dropoff').value });
    return { vehicleCategory, delivery };
  }
  function clearPassenger() {
    $('passenger-kind').value = 'self'; $('passenger-name').value = ''; $('passenger-phone').value = '';
    $('passenger-consent').checked = false; $('guest-passenger-fields').hidden = true;
  }
  clearPassenger();
  $('passenger-form').addEventListener('submit', (event) => event.preventDefault());
  $('passenger-kind').addEventListener('change', () => {
    if ($('passenger-kind').value !== 'guest') clearPassenger();
    else { $('guest-passenger-fields').hidden = false; $('passenger-name').focus(); }
  });
  for (const id of ['passenger-name', 'passenger-phone']) $(id).addEventListener('input', () => { $('passenger-consent').checked = false; });
  $('delivery-details-form').addEventListener('submit', (event) => event.preventDefault());
  $('request-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy || state.user?.role !== 'customer' || !categories.selected().ridePreview) return;
    let options;
    try { options = requestOptions(); } catch (error) { $('page-error').textContent = error.message; return; }
    const destination = selectedSampleDestination();
    if (!destination) { $('page-error').textContent = 'Type a destination from the suggested Abuja areas.'; $('request-destination').focus(); return; }
    $('request-destination').value = destination.name;
    const data = { pickupId: $('request-pickup').value, destinationId: destination.id, ...options };
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

  $('fare-open-chat').addEventListener('click', () => {
    const panel = $('chat-panel');
    panel.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    if (!$('chat-content').hidden) $('chat-message').focus?.();
  });
  $('fare-open-call').addEventListener('click', () => {
    $('calls-panel').scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    $('call-start').focus?.();
  });

  $('booking-service-ride').addEventListener('click', () => { if (busy) return; courier = false; clearPassenger(); clearDelivery(); categories.allow(null); categories.select('standard'); });
  $('booking-service-courier').addEventListener('click', () => { if (busy) return; courier = true; clearPassenger(); categories.allow(['standard', 'motorcycle', 'van', 'truck']); if (!supportsParcelCategory(categories.selected().id)) categories.select('standard'); updateCategoryVisibility(); updateButtons(); });
  updateQuote();
  $('driver-edit-vehicle').addEventListener('click', () => { if (!busy && state.user?.role === 'driver') return onEditVehicle(); });
  $('history-refresh').addEventListener('click', () => onHistory(null));
  $('history-more').addEventListener('click', () => { if (state.historyCursor) onHistory(state.historyCursor); });
  return Object.freeze({
    render, requestOptions,
    selectCategory(id) { categories.select(id); },
    rideCreated() { clearPassenger(); clearDelivery(); },
    tick: updateButtons,
    setBusy(value) { busy = value; tripView.setBusy(value); updateButtons(); },
    select(id) { selectedId = id; },
    selected: selectedRide,
    reset() {
      state = { user: null, rides: [], available: [], drivers: [], reports: [], history: [] };
      categories.reset();
      clearPassenger(); passengerCategory = 'standard'; passengerAccount = null;
      $('detail-passenger').textContent = ''; $('detail-passenger').hidden = true;
      for (const id of ['delivery-description', 'delivery-weight', 'delivery-recipient', 'delivery-pickup', 'delivery-dropoff']) $(id).value = '';
      $('detail-delivery').textContent = ''; $('detail-delivery').hidden = true;
      selectedId = null; detailId = null; renderedLists = ''; renderedDetail = ''; offerCountdowns = [];
      $('ride-detail').hidden = true;
      for (const id of ['detail-title', 'detail-person', 'detail-reference', 'detail-status', 'fare-value', 'fare-label',
        'fare-guidance', 'fare-expiry', 'driver-vehicle', 'driver-status', 'driver-guidance', 'account-identity', 'matching-status']) $(id).textContent = '';
      $('live-offer-amount').value = ''; $('accept-fare').onclick = null;
      $('request-pickup').value = currentPickupId; $('request-destination').value = ''; updateQuote();
      $('live-offer-history').replaceChildren(); $('available-list').replaceChildren(); $('driver-applications').replaceChildren();
      $('chat-reports-list').replaceChildren();
      $('ride-list').replaceChildren(); $('history-list').replaceChildren(); tripView.reset();
      renderVehicleCard($('driver-vehicle-card'), null); renderVehicleCard($('detail-vehicle-card'), null);
    },
  });
}
