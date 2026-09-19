import { canShareLocation, insideAbuja } from '/shared/locations.mjs';

export function createLocationSharing({ client, device, view, makeId = () => crypto.randomUUID(), now = Date.now, serverNow = Date.now }) {
  const headers = { locationClient: makeId() };
  let user = null, ride = null, share = null, stopWatch = null, latest = null, error = '', pending = false;
  let generation = 0, polling = null, updating = null, ending = null, sequence = 0, lastSend = -Infinity, lastContact = 0, pendingAt = 0;
  const command = (path, data) => client.command(path, data, headers);
  const current = (epoch) => epoch === generation && Boolean(user);
  const driver = () => user?.role === 'driver' && user.driver?.status === 'approved';
  function render() { view.renderTracking({ user, ride, share, pending, ending: Boolean(ending), sharing: Boolean(stopWatch), error,
    supported: device.supported(), now: serverNow() }); }
  function release() { stopWatch?.(); stopWatch = null; latest = null; updating = null; sequence = 0; }
  function reset() { generation++; release(); user = ride = share = null; polling = ending = null; pending = false; error = ''; view.resetTracking(); }
  function context(account, selected) {
    if (user?.id !== account?.id || ride?.id !== selected?.id) {
      const previous = share;
      reset();
      if (previous?.active && previous.owned) void command(`/api/location-shares/${previous.id}/stop`, {}).catch(() => {});
    }
    user = account; ride = selected ?? null;
    if ((!driver() || !canShareLocation(ride?.status)) && (stopWatch || pending)) void stop();
    render();
  }
  function validFix(fix) {
    const value = { lat: fix.coords.latitude, lng: fix.coords.longitude, accuracy: fix.coords.accuracy,
      capturedAt: Math.round(serverNow() - Math.max(0, now() - fix.timestamp)) };
    if (!insideAbuja(value)) throw new Error('Your location is outside the Abuja preview area.');
    if (!Number.isFinite(value.accuracy) || value.accuracy <= 0 || value.accuracy > 200) throw new Error('Wait for a more accurate GPS fix (within 200 metres).');
    if (!Number.isFinite(fix.timestamp) || now() - fix.timestamp >= 30_000) throw new Error('GPS returned an old location. Request a fresh fix.');
    return value;
  }
  const message = (cause) => cause.code === 1 ? 'Location permission was denied. You can continue using chat.'
    : cause.code === 2 ? 'Your device could not determine its location.' : cause.code === 3 ? 'Location lookup timed out. Try again.'
      : cause.message ?? 'Location sharing is unavailable.';
  async function start() {
    if (!driver() || !canShareLocation(ride?.status) || share?.active || pending || ending || !device.supported()) return;
    const epoch = ++generation, rideId = ride.id; pending = true; pendingAt = now(); error = ''; render();
    try {
      const fix = await device.locate(); if (!current(epoch)) return;
      latest = validFix(fix);
      const result = await command(`/api/rides/${rideId}/location/start`, {});
      if (!current(epoch)) { if (result.share?.active) void command(`/api/location-shares/${result.share.id}/stop`, {}).catch(() => {}); return; }
      share = result.share;
      if (!share?.active || !share.owned) { release(); return; }
      sequence = share.sequence; lastSend = -Infinity; lastContact = now();
      const cancelWatch = device.watch((next) => {
        if (!current(epoch)) return;
        try { latest = validFix(next); error = ''; }
        catch (cause) { error = message(cause); }
        render();
      }, (cause) => { if (current(epoch)) { error = message(cause); void stop(); } });
      if (current(epoch)) stopWatch = cancelWatch; else cancelWatch();
    } catch (cause) {
      if (current(epoch)) { error = message(cause); if (share?.active) void stop(); else release(); }
    } finally { if (current(epoch)) { pending = false; render(); void publish(); } }
  }
  function publish() {
    if (!stopWatch || !share?.active || !share.owned || !latest || updating || now() - lastSend < 10_000 || serverNow() - latest.capturedAt >= 30_000) return;
    const epoch = generation, id = share.id, data = { sequence: ++sequence, ...latest };
    lastSend = now();
    const task = (async () => {
      try {
        const result = await client.request(`/api/location-shares/${id}/position`, { ...headers, method: 'POST', data });
        if (current(epoch)) { share = result.share; lastContact = now(); error = ''; }
      } catch (cause) { if (current(epoch)) { error = message(cause); if ([401, 403, 404, 409].includes(cause.status)) void stop(); } }
      finally { if (updating === task) updating = null; if (current(epoch)) render(); }
    })();
    updating = task; return task;
  }
  async function stop() {
    if (ending) return ending;
    const previous = share, epoch = ++generation; release(); pending = false; render();
    if (!previous?.active || !driver()) return;
    const task = (async () => {
      try { await command(`/api/location-shares/${previous.id}/stop`, {}); if (current(epoch)) share = null; }
      catch { if (current(epoch)) error = 'GPS is stopped on this device. Retry Stop sharing to clear the saved location, or wait for it to expire.'; }
      finally { if (ending === task) ending = null; if (current(epoch)) render(); }
    })();
    ending = task; render(); return task;
  }
  function poll() {
    if (!user || !ride || polling || pending || ending || !['customer', 'driver'].includes(user.role)) return polling ?? Promise.resolve();
    const epoch = generation, id = ride.id;
    const task = (async () => {
      try {
        const result = await client.request(`/api/rides/${id}/location`, headers);
        if (!current(epoch)) return;
        const previousId = share?.id;
        if (!result.share || result.share.id !== previousId || result.share.sequence >= (share?.sequence ?? 0)) share = result.share;
        if (stopWatch && (!share?.active || !share.owned || share.id !== previousId)) { generation++; release(); pending = false; }
        if (share?.owned && !stopWatch && !pending) { void stop(); return; }
        render();
      } catch (cause) { if (current(epoch)) { error = message(cause); if ([401, 403, 404, 409].includes(cause.status)) { generation++; release(); pending = false; share = null; } render(); } }
      finally { if (polling === task) polling = null; }
    })();
    polling = task; return task;
  }
  function tick() {
    if ((pending && now() - pendingAt >= 20_000) || (stopWatch && now() - lastContact >= 45_000)) {
      error = 'Location sharing stopped because a fresh update could not be sent.'; void stop();
    } else void publish();
    render();
  }
  return Object.freeze({ context, reset, start, stop, poll, tick, sharing: () => Boolean(stopWatch || pending),
    shutdown() { void stop(); }, snapshot: () => ({ share, pending, error, sharing: Boolean(stopWatch) }) });
}
