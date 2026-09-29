import { transportCategory } from '/shared/transport-categories.mjs';
import { insideNigeria } from '/shared/locations.mjs';

/** Draft coordinates and quotes are isolated by account and selection revision. */
export function createLocationPlanner({ client, view, onBook, onOnline, device = null, serverNow = Date.now }) {
  let vehicleCategory = 'standard', service = 'ride', rideFinds = 0;
  let user = null, settings = null, online = false, blocked = false, generation = 0, revision = 0;
  let pickup = null, destination = null, quote = null, target = 'destination', error = '', quoting = false, booking = false, locatingPickup = false, rideDiscovery = false;
  let results = { pickup: [], destination: [] }, searching = { pickup: false, destination: false }, searches = { pickup: 0, destination: 0 };
  function render() { view.renderPlanner({ user, settings, online, blocked, pickup, destination, quote, target, error, results, searching, quoting, booking, vehicleCategory, service,
    rideDiscovery, locatingPickup, supported: !device || device.supported(), expired: Boolean(quote && serverNow() >= quote.expiresAt) }); }
  function reset() {
    generation++; revision++; rideFinds++; vehicleCategory = 'standard'; service = 'ride'; user = null; settings = null; online = false; blocked = false; pickup = destination = quote = null;
    target = 'destination'; error = ''; quoting = booking = locatingPickup = rideDiscovery = false; results = { pickup: [], destination: [] }; searching = { pickup: false, destination: false }; searches = { pickup: 0, destination: 0 };
    view.resetPlanner(); onOnline(false, null);
  }
  async function setContext(account, hasOpenRide) {
    if (user?.id !== account?.id) { const category = user ? 'standard' : vehicleCategory, selectedService = user ? 'ride' : service; reset(); vehicleCategory = category; service = selectedService; }
    user = account && ['customer', 'driver'].includes(account.role) ? account : null;
    blocked = hasOpenRide;
    render();
    if (user && !settings && !(user.role === 'driver' && user.driver?.status !== 'approved')) {
      const epoch = generation;
      try { const response = await client.request('/api/locations'); if (generation === epoch) { settings = response.settings; onOnline(online, settings); render(); } }
      catch (cause) { if (generation === epoch) { error = cause.message; render(); } }
    }
  }
  function enable() { if (!settings?.enabled || !user) return; online = !online; if (!online) { revision++; quoting = locatingPickup = false; searching = { pickup: false, destination: false }; searches.pickup++; searches.destination++; } onOnline(online, settings); render(); }
  function clear(side) {
    if (!['pickup', 'destination'].includes(side)) return;
    if (side === 'pickup') { pickup = null; locatingPickup = false; } else destination = null;
    results[side] = []; searches[side]++; searching[side] = false; revision++; quote = null; quoting = false; error = ''; render();
  }
  function select(side, value) {
    if (!online || user?.role !== 'customer' || blocked || booking || !insideNigeria(value)) { error = 'Choose a point inside Nigeria when you have no open request.'; render(); return; }
    clear(side);
    const selected = { lat: Number(value.lat.toFixed(6)), lng: Number(value.lng.toFixed(6)),
      name: value.name ?? `${side === 'pickup' ? 'Pickup' : 'Destination'} pin ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` };
    if (side === 'pickup') pickup = selected; else destination = selected;
    view.selected(side, selected); render();
  }
  async function search(side, query) {
    if (!online || user?.role !== 'customer' || blocked || !['pickup', 'destination'].includes(side)) return [];
    clear(side); const epoch = generation, request = ++searches[side]; searching[side] = true; render();
    try {
      const response = await client.request('/api/locations/search', { method: 'POST', data: { query } });
      if (generation !== epoch || searches[side] !== request) return [];
      results[side] = response.places; error = results[side].length ? '' : 'No result in Nigeria. Try a landmark or nearby place.';
      return results[side];
    } catch (cause) {
      if (generation === epoch && searches[side] === request) error = cause.message;
      return [];
    } finally { if (generation === epoch && searches[side] === request) { searching[side] = false; render(); } }
  }
  async function useCurrentPickup() {
    if (!online || user?.role !== 'customer' || blocked || booking || locatingPickup) return false;
    // A previous manual or delivery pickup cannot satisfy a fresh passenger GPS read.
    clear('pickup');
    if (!device?.supported()) { error = 'Current location needs browser geolocation on HTTPS or localhost.'; render(); return false; }
    const epoch = generation, request = ++searches.pickup; locatingPickup = true; error = ''; render();
    try {
      const fix = await device.locate();
      const coords = fix.coords ?? {};
      const value = { lat: Number(coords.latitude), lng: Number(coords.longitude), name: 'Current location' };
      if (!Number.isFinite(coords.accuracy) || coords.accuracy <= 0 || coords.accuracy > 200) throw new Error('Your pickup location is not accurate enough yet. Try again in an open area.');
      if (!insideNigeria(value)) throw new Error('Your current pickup must be inside Nigeria.');
      if (generation !== epoch || searches.pickup !== request) return false;
      pickup = { lat: Number(value.lat.toFixed(6)), lng: Number(value.lng.toFixed(6)), name: value.name };
      results.pickup = []; searching.pickup = false; revision++; quote = null; error = ''; view.selected('pickup', pickup);
      return true;
    } catch (cause) { if (generation === epoch && searches.pickup === request) error = cause instanceof Error ? cause.message : 'Could not read your current location.'; return false; }
    finally { if (generation === epoch && searches.pickup === request) { locatingPickup = false; render(); } }
  }
  async function findRides(query) {
    // Keep the first submitted lookup alive during the pending permission prompt.
    if (locatingPickup) return;
    if (!settings?.enabled || service !== 'ride' || user?.role !== 'customer' || blocked || booking) {
      error = settings ? 'Nationwide ride search is unavailable right now.' : 'Checking nationwide ride search…'; render(); return;
    }
    rideDiscovery = true;
    target = 'destination';
    if (!online) { online = true; onOnline(true, settings); render(); }
    const epoch = generation, destinationRequest = searches.destination, find = ++rideFinds;
    // A passenger ride always starts from a fresh device location. Find rides is the
    // explicit user action that permits this one-time GPS read; typed pickup remains
    // available to delivery flows, not as the default passenger pickup.
    const located = await useCurrentPickup();
    // Editing the destination, changing service or starting another search while
    // permission is pending makes the submitted query obsolete.
    if (generation !== epoch || searches.destination !== destinationRequest || rideFinds !== find || service !== 'ride' || !rideDiscovery || !online) return;
    if (!located) {
      error = error || 'Allow current-location access to find rides from where you are.';
      render(); return;
    }
    const places = await search('destination', query);
    if (places.length === 1) await chooseRidePlace('destination', places[0]);
  }
  async function prepareRideOptions() {
    if (!rideDiscovery || !destination || blocked || booking) return;
    if (!pickup) {
      const located = await useCurrentPickup();
      if (!located || !pickup) {
        error = error || 'Confirm your pickup below to see ride options and fares.';
        render(); return;
      }
    }
    await preview();
  }
  async function chooseRidePlace(side, value) {
    select(side, value);
    if (side === 'destination') await prepareRideOptions();
    else if (side === 'pickup' && destination && rideDiscovery) await preview();
  }
  async function useRidePickup() {
    if (await useCurrentPickup() && pickup && destination && rideDiscovery) await preview();
  }
  async function preview() {
    if (!online || !pickup || !destination || blocked || quoting || user?.role !== 'customer') return;
    const epoch = generation, version = revision; quoting = true; quote = null; error = ''; render();
    try {
      const response = await client.command('/api/locations/quotes', { pickup, destination, vehicleCategory });
      if (generation === epoch && revision === version) quote = response.quote;
    } catch (cause) { if (generation === epoch && revision === version) error = cause.message; }
    finally { if (generation === epoch && revision === version) { quoting = false; render(); } }
  }
  async function book() {
    if (!quote || blocked || quoting || booking || user?.role !== 'customer' || serverNow() >= quote.expiresAt) return;
    const epoch = generation, selected = quote.id; booking = true; error = ''; render();
    try {
      const result = await onBook(selected);
      if (generation === epoch && result?.ride) { quote = null; blocked = true; }
    } catch (cause) { if (generation === epoch) error = cause.message; }
    finally { if (generation === epoch) { booking = false; render(); } }
  }
  return Object.freeze({ setCategory(id, selectedService = transportCategory(id)?.service) {
    if (booking || !transportCategory(id) || !['ride', 'delivery'].includes(selectedService) || (id === vehicleCategory && selectedService === service)) return;
    const serviceChanged = service !== selectedService;
    vehicleCategory = id; service = selectedService; revision++; quote = null; quoting = false; error = '';
    if (serviceChanged) {
      rideFinds++; searches.pickup++; searches.destination++;
      locatingPickup = false; searching = { pickup: false, destination: false };
      rideDiscovery = false; target = service === 'delivery' ? 'pickup' : 'destination';
      if (service === 'ride') pickup = null;
    }
    render();
  }, setContext, reset, enable, clear, select, search, findRides, chooseRidePlace, useRidePickup, useCurrentPickup, preview, book,
    setTarget(value) {
      if (!['pickup', 'destination'].includes(value)) return;
      if (service === 'ride' && rideDiscovery && value === 'pickup') { error = 'Ride pickup uses your current device location. Refresh it with Current location.'; render(); return; }
      target = value; render();
    },
    pick(value) { return rideDiscovery ? chooseRidePlace(target, value) : select(target, value); }, tick: render,
    snapshot: () => ({ pickup, destination, quote, online, results, error, vehicleCategory, service, rideDiscovery, target }),
  });
}
