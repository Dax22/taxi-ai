import { createMapView } from '../dashboard/map-view.mjs';
import { $ } from '../dashboard/dom.mjs';
import { EATS_STATUS } from '/shared/eats.mjs';

const field = (id) => $('food-tracking-' + id);
export function createFoodTrackingView({ onStart, onStop, loadSettings, createMap = createMapView }) {
  const map = createMap(field('map'));
  let state = null, mapOpen = false, settings = null, loading = false, mapError = '', generation = 0, identity = null;
  function renderTracking(next) {
    state = next;
    const key = next.order && next.user ? `${next.user.id}:${next.order.id}` : null;
    if (identity !== key) { generation++; identity = key; mapOpen = false; settings = null; loading = false; mapError = ''; map.reset(); }
    $('food-tracking').hidden = !key;
    if (!key) return;
    const courier = next.order.role === 'courier', position = next.share?.active ? next.share.position : null;
    const stale = !position || next.share.stale || next.now - position.capturedAt >= 30_000;
    field('title').textContent = courier ? 'Share your delivery location' : 'Your courier’s location';
    field('job').textContent = `Order ${next.order.id.slice(0, 8).toUpperCase()} · ${EATS_STATUS[next.order.status]}`;
    field('guidance').textContent = next.guidance || (courier
      ? 'Live location is required during this delivery. Choose Share my location before collecting food or confirming arrival. Stopping sharing pauses those steps; cancellation, delivery confirmation and support remain available.'
      : 'Courier location appears after collection. It may be temporarily hidden to protect a private pickup location. These are device-reported positions and can be inaccurate; an old position is marked as last known.');
    field('device').textContent = courier
      ? 'Keep this page open and visible. Browser tracking can pause when the screen locks or the app goes into the background. Use a supported native app build for continuous background tracking; this website cannot guarantee it.'
      : 'No position or route is invented when GPS is unavailable. Kemmy’s pickup update shows a map-based delivery estimate when one is available; it is not a live traffic countdown.';
    field('status').textContent = next.ending ? 'Stopping location sharing…' : next.pending ? 'Waiting for location permission and a GPS fix…'
      : position ? `${stale ? 'Last known courier location' : 'Courier location'} · ±${Math.round(position.accuracy)} m · ${Math.max(0, Math.floor((next.now - position.capturedAt) / 1000))}s old`
        : !courier && next.order.status === 'assigned' ? 'Courier location will appear after the food is collected.'
          : !courier ? 'Courier location is not currently available. It may be hidden near a private pickup location.'
            : next.share?.active ? 'Sharing enabled · waiting for the first courier location.' : 'Courier location is not currently available.';
    field('error').textContent = next.error;
    field('start').hidden = !courier || Boolean(next.share?.active) || next.pending;
    field('start').disabled = !next.supported || next.pending || next.ending;
    field('stop').hidden = !courier || (!next.share?.active && !next.pending);
    field('stop').disabled = next.ending;
    field('ownership').textContent = !courier ? '' : !next.supported ? 'Location access needs a supported browser on HTTPS or localhost.'
      : next.share?.active && !next.sharing ? 'Another window or device owns this sharing session. Stop sharing here before starting on this device.' : '';
    field('destination').textContent = next.order.address?.line ? `Delivery address: ${next.order.address.line}${next.order.address.point ? '' : ' · No exact destination pin was saved.'}` : 'No delivery address is available.';
    field('map-toggle').disabled = loading;
    field('map-toggle').textContent = loading ? 'Loading map settings…' : mapOpen ? 'Hide online map' : 'Show online map';
    field('map-note').textContent = mapError || (mapOpen ? settings?.attribution || 'Map tiles load from the configured map provider.' : 'Opening the map loads street tiles from the configured provider. It does not request your location.');
    field('map').hidden = !mapOpen;
    const destination = next.order.address?.point ? { ...next.order.address.point, name: 'Delivery destination' } : null;
    map.render({ enabled: mapOpen && Boolean(settings?.tiles), tiles: settings?.tiles, destination,
      driver: position, stale, fitPoints: [destination, position].filter(Boolean), focusKey: `${next.order.id}:${Boolean(position)}` });
  }
  field('start').addEventListener('click', onStart);
  field('stop').addEventListener('click', onStop);
  field('map-toggle').addEventListener('click', async () => {
    if (!state?.order || loading) return;
    if (mapOpen) { mapOpen = false; renderTracking(state); return; }
    const epoch = generation; loading = true; mapError = ''; renderTracking(state);
    try {
      const loaded = await loadSettings(); if (epoch !== generation) return; settings = loaded;
      if (!settings?.enabled || !settings?.tiles) { settings = null; mapError = 'Online maps are unavailable. The courier’s location status and delivery address remain available.'; }
      else mapOpen = true;
    } catch { if (epoch === generation) mapError = 'The map could not load. Try again; tracking status and delivery steps remain available.'; }
    finally { if (epoch === generation) { loading = false; renderTracking(state); } }
  });
  return Object.freeze({ renderTracking,
    focusSharing() { $('food-tracking').scrollIntoView({ block: 'center' }); const target = field('start').hidden || field('start').disabled ? field('status') : field('start'); target.focus(); },
    resetTracking() {
      generation++; identity = null; state = settings = null; mapOpen = loading = false; mapError = ''; map.reset(); $('food-tracking').hidden = true;
      for (const id of ['job', 'title', 'guidance', 'device', 'status', 'error', 'ownership', 'destination', 'map-note']) field(id).textContent = '';
    },
  });
}
