import { canShareLocation } from '/shared/locations.mjs';
import { formatNaira } from '/shared/demo-booking.mjs';
import { $, element } from './dom.mjs';
import { createMapView } from './map-view.mjs';
import { kemmyUpdate } from '/shared/kemmy.mjs';

export function createLocationView({ onEnable, onUsePickup, onSearch, onClear, onSelect, onPick, onTarget, onPreview, onBook, onStart, onStop, onRate = () => {} }) {
  const plannerMap = createMapView($('planner-map'), { onPick });
  const trackingMap = createMapView($('tracking-map'));
  let online = false, settings = null, tracking = null, planner = null;
  let kemmyKey = '', kemmyDismissed = false, ratingChoice = 0;
  const resultKeys = { pickup: '', destination: '' };
  function locked(id, value) { $(id).disabled = value; $(id).dataset.locked = String(value); }
  function renderPlanner(state) {
    planner = state;
    $('location-planner').hidden = state.user?.role !== 'customer';
    if (state.user?.role !== 'customer') { plannerMap.reset(); return; }
    $('planner-online').textContent = state.online ? 'Turn off online maps' : 'Enable online maps';
    locked('planner-online', !state.settings?.enabled || state.booking);
    $('planner-error').textContent = state.error;
    $('planner-blocked').hidden = !state.blocked;
    $('planner-content').hidden = !state.online;
    $('planner-provider-note').textContent = state.settings?.enabled
      ? `Current pickup uses your browser location. Address searches use ${state.settings.searchHost}; route points go to ${state.settings.routeHost}. Map areas load via ${state.settings.tileHost}. Enable only if you want to use these services.`
      : state.settings ? 'Online maps are disabled. You can use the sample-area demo below.' : 'Checking map availability…';
    $('location-pickup-fields').disabled = state.blocked || !state.online || state.booking;
    locked('location-pickup-current', state.locatingPickup || state.blocked || !state.online || state.booking || !state.supported);
    $('location-pickup-current').textContent = state.locatingPickup ? 'Reading your location…' : state.pickup ? 'Update current location' : 'Use current location';
    $('location-pickup-selected').textContent = state.locatingPickup ? 'Waiting for a fresh GPS fix…'
      : state.pickup ? `${state.pickup.name} · ${state.pickup.lat.toFixed(5)}, ${state.pickup.lng.toFixed(5)}` : 'Current location has not been set yet.';
    for (const side of ['pickup', 'destination']) {
      $(`location-${side}-fields`).disabled = state.blocked || !state.online || state.booking;
      locked(`location-${side}-search`, state.searching[side] || state.blocked || !state.online || state.booking);
      $(`location-${side}-selected`).textContent = state[side] ? `${state[side].name} · ${state[side].lat.toFixed(5)}, ${state[side].lng.toFixed(5)}` : `Choose ${side}.`;
      const key = JSON.stringify(state.results[side]);
      if (resultKeys[side] !== key) {
        resultKeys[side] = key; $(`location-${side}-results`).replaceChildren();
        for (const place of state.results[side]) {
          const row = element('li'), button = element('button', place.name, 'location-result'); button.type = 'button';
          button.addEventListener('click', () => onSelect(side, place)); row.append(button); $(`location-${side}-results`).append(row);
        }
      }
    }
    for (const side of ['pickup', 'destination']) { $(`location-target-${side}`).checked = state.target === side; $(`location-target-${side}`).disabled = state.blocked || !state.online || state.booking; }
    $('location-coordinate-fields').disabled = !state.online || state.blocked || state.booking;
    locked('location-preview', !state.pickup || !state.destination || state.blocked || state.quoting || state.booking || !state.online);
    $('location-preview').textContent = state.quoting ? 'Preparing your preview…' : 'Preview route and suggested fare';
    locked('location-book', !state.quote || state.expired || state.blocked || state.quoting || state.booking);
    $('location-quote').hidden = !state.quote;
    if (state.quote) {
      const route = state.quote.route, pricing = route.pricing;
      $('location-distance').textContent = `${(route.distanceMeters / 1000).toFixed(1)} km${route.distanceKind === 'straight_line' ? ' direct' : ''}`;
      $('location-duration').textContent = route.durationSeconds === null ? 'No driving ETA' : `${Math.ceil(route.durationSeconds / 60)} min`;
      $('location-price').textContent = formatNaira(route.suggestedFareKobo);
      $('location-formula').textContent = `${route.distanceKind === 'straight_line' ? 'Direct-distance delivery estimate, not a road route. Confirm access and timing with the driver. ' : ''}Illustrative formula (${pricing.categoryMultiplier ?? 1}× category factor): ${formatNaira(pricing.baseKobo)} base + ${formatNaira(pricing.perKmKobo)}/km + ${formatNaira(pricing.perMinuteKobo)}/min. Minimum ${formatNaira(pricing.minimumKobo)}, rounded up to ${formatNaira(pricing.incrementKobo)}.`;
      $('location-expiry').textContent = state.expired ? 'This route quote expired. Preview the route again.' : 'Quote valid for 15 minutes after preview. Both people can negotiate the fare.';
    }
    plannerMap.render({ enabled: state.online && Boolean(state.settings?.tiles), tiles: state.settings?.tiles,
      pickup: state.pickup, destination: state.destination, route: state.quote?.route.coordinates,
      focusKey: JSON.stringify([state.pickup, state.destination, state.quote?.id]) });
  }
  function renderTracking(state) {
    tracking = state;
    const visible = state.user && state.ride && ['customer', 'driver'].includes(state.user.role);
    $('location-tracking').hidden = !visible;
    if (!visible) { trackingMap.reset(); return; }
    const isDriver = state.user.role === 'driver' && state.user.driver?.status === 'approved';
    const activeTrip = canShareLocation(state.ride.status), position = state.share?.position;
    const stale = state.share?.stale || !position || state.now - position.capturedAt >= 30_000;
    const update = state.user.role === 'customer' ? kemmyUpdate(state.ride, { position: stale ? null : position, now: state.now, stale }) : null;
    const nextKey = update ? `${state.ride.id}:${state.ride.status}` : '';
    if (nextKey !== kemmyKey) { kemmyKey = nextKey; kemmyDismissed = false; ratingChoice = 0; }
    $('kemmy-card').hidden = !update || kemmyDismissed;
    $('kemmy-reopen').hidden = !update || !kemmyDismissed;
    $('kemmy-message').textContent = update?.message ?? '';
    $('kemmy-note').textContent = update?.note ?? '';
    $('kemmy-rating').hidden = update?.phase !== 'rate' || Boolean(state.ride.rating);
    for (const button of document.querySelectorAll('[data-kemmy-stars]')) {
      const stars = Number(button.dataset.kemmyStars);
      button.textContent = stars <= ratingChoice ? '★' : '☆';
      button.setAttribute('aria-pressed', String(stars === ratingChoice));
    }
    $('kemmy-rate').disabled = !ratingChoice;
    $('tracking-error').textContent = state.error;
    $('tracking-online').textContent = online ? 'Turn off online maps' : 'Enable online maps';
    locked('tracking-online', !settings?.enabled);
    $('tracking-start').hidden = !isDriver || !activeTrip || Boolean(state.share?.active) || state.pending;
    locked('tracking-start', !state.supported || state.pending || state.ending);
    $('tracking-stop').hidden = !isDriver || (!state.share?.active && !state.pending);
    locked('tracking-stop', state.ending);
    $('tracking-status').textContent = state.ending ? 'Stopping location sharing…' : state.pending ? 'Waiting for location permission and a GPS fix…'
      : state.share?.active ? position ? `${stale ? 'Last known location' : 'Driver location'} · ±${position.accuracy} m · ${Math.max(0, Math.floor((state.now - position.capturedAt) / 1000))}s old`
        : 'Sharing enabled · waiting for a GPS fix' : activeTrip ? 'Driver location is not being shared.' : 'Location sharing is available during a confirmed trip.';
    $('tracking-guidance').textContent = isDriver ? !state.supported ? 'Location sharing needs browser geolocation and a secure connection.'
      : state.share?.active && !state.sharing ? 'Another window owns this sharing session. Stop it here before starting a new one.'
        : state.ride.delivery ? 'Share only when you choose. The sender can see your latest position; after collection, the accepted parcel recipient can also see it until delivery. Use Stop sharing to end GPS updates.' : 'Share only when you choose. Your assigned customer can see your latest position. Use Stop sharing to end GPS updates. Switching account modes keeps active trip sharing running.'
      : 'The driver chooses when to share. Positions are browser-reported and may be inaccurate. Stale positions are marked as last known.';
    const route = state.ride.route;
    $('tracking-route-summary').textContent = `Journey ${state.ride.id.slice(0, 8).toUpperCase()} · ${state.ride.pickup?.name ?? 'Pickup'} → ${state.ride.destination?.name ?? 'Destination'} · ` + (route?.distanceKind === 'straight_line' ? `${(route.distanceMeters / 1000).toFixed(1)} km in a straight line · no driving route or ETA` : route ? `${(route.distanceMeters / 1000).toFixed(1)} km · ${update?.tripMinutes ?? Math.ceil(route.durationSeconds / 60)} min ${state.ride.status === 'completed' ? 'planned driving time' : 'estimated driving'} · excludes live traffic and pickup arrival time`
      : 'Sample-area journey; no saved road route.');
    $('tracking-eta').textContent = update?.pickupMinutes ? `Estimated pickup: about ${update.pickupMinutes} min from the latest driver GPS. Straight-line estimate at a fixed speed; roads and traffic may change it.`
      : update?.tripMinutes && ['arrived','in_progress'].includes(state.ride.status) ? `Estimated time to destination: about ${update.tripMinutes} min from the planned map route.` : '';
    $('tracking-provider-note').textContent = settings?.enabled ? `Online maps load the visible area via ${settings.tileHost}. GPS updates are shared through Taxi Ai; they are not sent to the route or search service.` : 'Online street maps are currently unavailable.';
    trackingMap.render({ enabled: online && Boolean(settings?.tiles), tiles: settings?.tiles,
      pickup: route?.pickup, destination: route?.destination, route: route?.coordinates, driver: position,
      vehicle: state.ride.driver?.vehicle, stale, focusKey: state.ride.id });
  }
  $('location-pickup-current').addEventListener('click', onUsePickup);
  $('location-pickup-form').addEventListener('submit', (event) => { event.preventDefault(); onSearch('pickup', $('location-pickup-query').value); });
  $('location-pickup-query').addEventListener('input', () => onClear('pickup'));
  for (const side of ['pickup', 'destination']) $(`location-target-${side}`).addEventListener('change', () => onTarget(side));
  $('location-destination-form').addEventListener('submit', (event) => { event.preventDefault(); onSearch('destination', $('location-destination-query').value); });
  $('location-destination-query').addEventListener('input', () => onClear('destination'));
  $('location-coordinate-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const lat = $('location-latitude').value.trim(), lng = $('location-longitude').value.trim();
    if (!lat || !lng) return;
    onPick({ lat: Number(lat), lng: Number(lng), name: $('location-pin-name').value.trim() || undefined });
  });
  $('planner-online').addEventListener('click', onEnable); $('tracking-online').addEventListener('click', onEnable);
  $('location-preview').addEventListener('click', onPreview); $('location-book').addEventListener('click', onBook);
  $('tracking-start').addEventListener('click', onStart); $('tracking-stop').addEventListener('click', onStop);
  $('kemmy-dismiss').addEventListener('click', () => { kemmyDismissed = true; $('kemmy-card').hidden = true; $('kemmy-reopen').hidden = false; });
  $('kemmy-reopen').addEventListener('click', () => { kemmyDismissed = false; $('kemmy-card').hidden = false; $('kemmy-reopen').hidden = true; });
  for (const button of document.querySelectorAll('[data-kemmy-stars]')) button.addEventListener('click', () => {
    ratingChoice = Number(button.dataset.kemmyStars);
    if (tracking) renderTracking(tracking);
  });
  $('kemmy-rate').addEventListener('click', () => { if (tracking?.ride && ratingChoice && !tracking.ride.rating) onRate(tracking.ride.id, ratingChoice); });
  return Object.freeze({ renderPlanner, renderTracking,
    setOnline(enabled, configuration) { online = enabled; settings = configuration; if (tracking) renderTracking(tracking); },
    selected(side, point) { $(`location-${side}-query`).value = point.name; },
    resetPlanner() {
      planner = null; plannerMap.reset(); $('location-planner').hidden = true;
      $('location-pickup-query').value = ''; $('location-pickup-results').replaceChildren(); $('location-pickup-selected').textContent = ''; resultKeys.pickup = '';
      $('location-destination-query').value = ''; $('location-destination-results').replaceChildren(); $('location-destination-selected').textContent = ''; resultKeys.destination = '';
      for (const id of ['location-latitude', 'location-longitude', 'location-pin-name']) $(id).value = '';
      $('location-quote').hidden = true; $('planner-error').textContent = '';
    },
    resetTracking() { tracking = null; kemmyKey = ''; kemmyDismissed = false; ratingChoice = 0; trackingMap.reset(); $('location-tracking').hidden = true; $('kemmy-card').hidden = true; $('kemmy-reopen').hidden = true; $('tracking-error').textContent = ''; $('tracking-status').textContent = ''; },
  });
}
