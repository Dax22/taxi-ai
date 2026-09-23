import { transportCategory } from '/shared/transport-categories.mjs';
import { insideAbuja } from '/shared/locations.mjs';

/** Draft coordinates and quotes are isolated by account and selection revision. */
export function createLocationPlanner({ client, view, onBook, onOnline, device = null, serverNow = Date.now }) {
  let vehicleCategory = 'standard';
  let user = null, settings = null, online = false, blocked = false, generation = 0, revision = 0;
  let pickup = null, destination = null, quote = null, target = 'destination', error = '', quoting = false, booking = false, locatingPickup = false;
  let results = { pickup: [], destination: [] }, searching = { pickup: false, destination: false }, searches = { pickup: 0, destination: 0 };
  function render() { view.renderPlanner({ user, settings, online, blocked, pickup, destination, quote, target, error, results, searching, quoting, booking, vehicleCategory,
    locatingPickup, supported: !device || device.supported(), expired: Boolean(quote && serverNow() >= quote.expiresAt) }); }
  function reset() {
    generation++; revision++; vehicleCategory = 'standard'; user = null; settings = null; online = false; blocked = false; pickup = destination = quote = null;
    target = 'destination'; error = ''; quoting = booking = locatingPickup = false; results = { pickup: [], destination: [] }; searching = { pickup: false, destination: false }; searches = { pickup: 0, destination: 0 };
    view.resetPlanner(); onOnline(false, null);
  }
  async function setContext(account, hasOpenRide) {
    if (user?.id !== account?.id) { const category = user ? 'standard' : vehicleCategory; reset(); vehicleCategory = category; }
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
    if (side === 'pickup') pickup = null; else destination = null;
    results[side] = []; searches[side]++; searching[side] = false; revision++; quote = null; quoting = false; error = ''; render();
  }
  function select(side, value) {
    if (!online || user?.role !== 'customer' || blocked || booking || !insideAbuja(value)) { error = 'Choose a point inside the Abuja preview area when you have no open request.'; render(); return; }
    clear(side);
    const selected = { lat: Number(value.lat.toFixed(6)), lng: Number(value.lng.toFixed(6)),
      name: value.name ?? `${side === 'pickup' ? 'Pickup' : 'Destination'} pin ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` };
    if (side === 'pickup') pickup = selected; else destination = selected;
    view.selected(side, selected); render();
  }
  async function search(side, query) {
    if (!online || user?.role !== 'customer' || blocked || side !== 'destination') return;
    clear(side); const epoch = generation, request = ++searches[side]; searching[side] = true; render();
    try {
      const response = await client.request('/api/locations/search', { method: 'POST', data: { query } });
      if (generation !== epoch || searches[side] !== request) return;
      results[side] = response.places; error = results[side].length ? '' : 'No result in the Abuja preview area. Try a landmark or place a pin.';
    } catch (cause) { if (generation === epoch && searches[side] === request) error = cause.message; }
    finally { if (generation === epoch && searches[side] === request) { searching[side] = false; render(); } }
  }
  async function useCurrentPickup() {
    if (!online || user?.role !== 'customer' || blocked || booking || locatingPickup) return;
    if (!device?.supported()) { error = 'Current location needs browser geolocation on HTTPS or localhost.'; render(); return; }
    const epoch = generation, request = ++searches.pickup; locatingPickup = true; error = ''; quote = null; render();
    try {
      const fix = await device.locate();
      const coords = fix.coords ?? {};
      const value = { lat: Number(coords.latitude), lng: Number(coords.longitude), name: 'Current location' };
      if (!Number.isFinite(coords.accuracy) || coords.accuracy <= 0 || coords.accuracy > 200) throw new Error('Your pickup location is not accurate enough yet. Try again in an open area.');
      if (!insideAbuja(value)) throw new Error('Your current pickup must be inside the Abuja preview area.');
      if (generation !== epoch || searches.pickup !== request) return;
      pickup = { lat: Number(value.lat.toFixed(6)), lng: Number(value.lng.toFixed(6)), name: value.name };
      results.pickup = []; searching.pickup = false; revision++; quote = null; error = ''; view.selected('pickup', pickup);
    } catch (cause) { if (generation === epoch && searches.pickup === request) error = cause instanceof Error ? cause.message : 'Could not read your current location.'; }
    finally { if (generation === epoch && searches.pickup === request) { locatingPickup = false; render(); } }
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
  return Object.freeze({ setCategory(id) { if (!booking && transportCategory(id) && id !== vehicleCategory) { vehicleCategory = id; revision++; quote = null; quoting = false; error = ''; render(); } }, setContext, reset, enable, clear, select, search, useCurrentPickup, preview, book,
    setTarget(value) { if (value === 'destination') { target = value; render(); } },
    pick(value) { select(target, value); }, tick: render,
    snapshot: () => ({ pickup, destination, quote, online, results, error, vehicleCategory }),
  });
}
