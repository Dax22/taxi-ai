import { insideAbuja } from '/shared/locations.mjs';
import { POSITION_MS } from '/shared/matching.mjs';

/** Separate consent and browser lifetime from location sharing on a booked trip. */
export function createAvailabilityController({ client, device, view, onStatus = () => {}, makeId = () => crypto.randomUUID(), now = Date.now, serverNow = Date.now }) {
  const headers = { availabilityClient: makeId() };
  let user = null, busy = false, availability = null, settings = null, pending = false, running = false, error = '';
  let generation = 0, stopWatch = null, latest = null, polling = null, updating = null, ending = null;
  let lastSend = -Infinity, lastContact = 0, pendingAt = 0, sequence = 0;
  const current = (epoch) => epoch === generation && Boolean(user);
  const command = (path, data) => client.command(path, data, headers);
  function render() {
    const online = Boolean(availability?.online && availability.expiresAt > serverNow());
    view.render({ user, busy, availability, online, settings, pending, running, ending: Boolean(ending), error, supported: device.supported() });
    onStatus(online && !busy && !pending && !ending && (!availability.owned || running));
  }
  function release() { stopWatch?.(); stopWatch = null; latest = null; running = false; updating = null; sequence = 0; }
  function reset() {
    generation++; release(); user = availability = settings = null; polling = ending = null;
    pending = busy = false; error = ''; render();
  }
  function context(account, occupied = false) {
    if (user?.id !== account?.id) {
      const previous = availability; reset();
      if (previous?.online && previous.owned) void command(`/api/availability/${previous.id}/offline`, {}).catch(() => {});
    }
    user = account; busy = occupied;
    if ((busy || (user?.driver?.status !== 'approved' || !user?.driver?.eligibility?.eligible)) && (running || pending)) void stop();
    render();
  }
  function fix(value) {
    const age = now() - value.timestamp;
    const point = { lat: value.coords.latitude, lng: value.coords.longitude, accuracy: value.coords.accuracy,
      capturedAt: Math.round(serverNow() - Math.max(0, age)) };
    if (!insideAbuja(point)) throw new Error('Your location is outside the Abuja preview area. Local testing can use a sample area.');
    if (!Number.isFinite(point.accuracy) || point.accuracy <= 0 || point.accuracy > 200) throw new Error('Wait for a location accurate to within 200 metres.');
    if (!Number.isFinite(age) || age >= POSITION_MS || age < -5000) throw new Error('A fresh device location is required.');
    return point;
  }
  const message = (cause) => cause.code === 1 ? 'Location permission was denied. You remain offline.'
    : cause.code === 2 ? 'Your device could not determine its location.'
      : cause.code === 3 ? 'Location lookup timed out. Try again.' : cause.message ?? 'Availability could not be updated.';
  async function start(mode = 'gps', areaId = null) {
    if (user?.role !== 'driver' || (user.driver?.status !== 'approved' || !user.driver?.eligibility?.eligible) || busy || pending || ending || availability?.online || !settings) return;
    if ((mode === 'sample' && !settings.allowSimulation) || (mode === 'gps' && !device.supported())) return;
    const epoch = ++generation; pending = true; pendingAt = now(); error = ''; render();
    try {
      const value = mode === 'gps' ? fix(await device.locate()) : null;
      if (!current(epoch)) return;
      const result = await command('/api/availability/online', mode === 'gps' ? { mode, position: value } : { mode, areaId });
      if (!current(epoch)) {
        if (result.availability?.online) void command(`/api/availability/${result.availability.id}/offline`, {}).catch(() => {});
        return;
      }
      availability = result.availability;
      if (!availability?.online || !availability.owned) return;
      running = true; latest = value; sequence = availability.sequence; lastSend = lastContact = now();
      if (mode === 'gps') {
        const cancel = device.watch((next) => {
          if (!current(epoch)) return;
          try { latest = fix(next); error = ''; } catch (cause) { error = message(cause); }
          render();
        }, (cause) => { if (current(epoch)) { error = message(cause); void stop(); } });
        if (current(epoch)) stopWatch = cancel; else cancel();
      }
    } catch (cause) {
      if (current(epoch)) { error = message(cause); if (availability?.online) void stop(); else release(); }
    } finally { if (current(epoch)) { pending = false; render(); } }
  }
  function publish() {
    if (!running || !availability?.online || !availability.owned || updating || now() - lastSend < 10_000) return;
    const epoch = generation, id = availability.id, mode = availability.mode; lastSend = now();
    const task = (async () => {
      try {
        // A stationary watch may not emit again. Reacquire a fresh fix before it ages out.
        if (mode === 'gps' && (!latest || serverNow() - latest.capturedAt >= 15_000)) {
          const value = fix(await device.locate()); if (!current(epoch)) return; latest = value;
        }
        if (!current(epoch)) return;
        const data = { sequence: ++sequence, ...(mode === 'gps' ? { position: latest } : {}) };
        const result = await client.request(`/api/availability/${id}/position`, { ...headers, method: 'POST', data });
        if (current(epoch)) { availability = result.availability; lastContact = now(); error = ''; }
      } catch (cause) {
        if (current(epoch)) { error = message(cause); if ([401, 403, 404, 409].includes(cause.status) || cause.code === 1) void stop(); }
      } finally { if (updating === task) updating = null; if (current(epoch)) render(); }
    })();
    updating = task; return task;
  }
  function stop() {
    if (ending) return ending;
    const previous = availability, epoch = ++generation; release(); pending = false; render();
    if (!previous?.online || user?.role !== 'driver') return Promise.resolve();
    const task = (async () => {
      try { await command(`/api/availability/${previous.id}/offline`, {}); if (current(epoch)) availability = null; }
      catch { if (current(epoch)) error = 'Location updates stopped here. Retry Go offline; server availability expires within one minute.'; }
      finally { if (ending === task) ending = null; if (current(epoch)) render(); }
    })();
    ending = task; render(); return task;
  }
  function poll() {
    if (user?.role !== 'driver' || polling || pending || ending) return polling ?? Promise.resolve();
    const epoch = generation;
    const task = (async () => {
      try {
        const result = await client.request('/api/availability', headers); if (!current(epoch)) return;
        const previous = availability; settings = result.settings;
        if (!result.availability || result.availability.id !== previous?.id || result.availability.sequence >= (previous?.sequence ?? 0)) availability = result.availability;
        if (running && (!availability?.online || !availability.owned || availability.id !== previous?.id)) { generation++; release(); pending = false; }
        if (availability?.owned && !running && !pending) { void stop(); return; }
        render();
      } catch (cause) {
        if (current(epoch)) {
          error = message(cause);
          if ([401, 403, 404, 409].includes(cause.status)) { generation++; release(); pending = false; availability = null; }
          render();
        }
      } finally { if (polling === task) polling = null; }
    })();
    polling = task; return task;
  }
  function tick() {
    if ((pending && now() - pendingAt >= 20_000) || (running && (now() - lastContact >= 35_000 || availability?.expiresAt <= serverNow()))) {
      error = 'You went offline because fresh updates could not be confirmed.'; void stop();
    } else void publish();
    render();
  }
  async function prepareSwitch(confirmOffline = false) {
    if (pending || ending) throw new Error('Wait for the availability action to finish before changing mode.');
    const epoch = generation;
    const result = await client.request('/api/availability', headers);
    if (!current(epoch)) throw new Error('Your availability changed. Refresh before changing mode.');
    availability = result.availability; settings = result.settings; render();
    if (availability?.online) {
      if (!confirmOffline) return false;
      const id = availability.id;
      generation++; release(); pending = false;
      // Do not treat a failed POST or stale local timer as confirmed offline.
      await command(`/api/availability/${id}/offline`, {});
      const checked = await client.request('/api/availability', headers);
      availability = checked.availability; render();
      if (availability?.online) throw new Error('You are online in another window. Go offline there, then retry switching.');
    } else { generation++; release(); }
    return true;
  }
  return Object.freeze({ context, reset, start, stop, poll, tick, shutdown: () => { void stop(); },
    prepareSwitch,
    active: () => running || pending, snapshot: () => ({ availability, settings, running, pending, error }) });
}
