import { $, element } from '../dashboard/dom.mjs';
import { createMapView } from '../dashboard/map-view.mjs';
import { safetyTime } from '../dashboard/safety-format.mjs';

const statuses = { requested: 'Finding a courier', negotiating: 'Agreeing the delivery fare', agreed: 'Awaiting sender confirmation', booked: 'Courier booked', on_way: 'Courier heading to pickup', arrived: 'Courier at pickup', in_progress: 'Parcel on its way', completed: 'Delivered', cancelled: 'Delivery cancelled', expired: 'No courier found' };
export function createParcelsView({ onSelect, onAccept, onRefresh, now = Date.now }) {
  const map = createMapView($('parcel-map')); let current = null, online = false;
  $('parcel-accept').addEventListener('click', onAccept);
  $('parcel-refresh').addEventListener('click', onRefresh);
  $('parcel-map-enable').addEventListener('click', () => { online = !online; render(current); });
  function render(state) {
    current = state;
    const { user, parcels, selectedId, settings, busy, loading, error, hasInvitation } = state;
    $('parcel-auth').hidden = Boolean(user);
    $('parcel-identity').textContent = user ? `Signed in as ${user.name}` : '';
    $('parcel-invitation').hidden = !hasInvitation;
    $('parcel-accept').disabled = !user || busy || loading;
    $('parcel-refresh').disabled = busy || loading;
    $('parcel-error').textContent = error;
    $('parcel-state').textContent = loading ? 'Updating your parcels…' : !user ? 'Sign in to receive and track your parcel.' : parcels.length ? 'Choose a delivery below.' : 'No incoming parcels yet. Open the private invitation sent by your sender.';
    $('parcel-list').replaceChildren();
    for (const parcel of parcels) {
      const button = element('button', undefined, 'request-row'); button.type = 'button';
      button.setAttribute('aria-pressed', String(parcel.rideId === selectedId));
      button.append(element('strong', parcel.description), element('span', statuses[parcel.status] ?? parcel.status), element('small', `${parcel.reference} · ${parcel.destination}`));
      button.addEventListener('click', () => onSelect(parcel.rideId)); $('parcel-list').append(button);
    }
    const parcel = parcels.find((item) => item.rideId === selectedId);
    $('parcel-detail').hidden = !parcel; $('parcel-details').replaceChildren();
    $('parcel-pin-panel').hidden = true; $('parcel-pin').textContent = '';
    $('parcel-map-enable').hidden = !parcel || parcel.status !== 'in_progress' || !settings?.enabled;
    $('parcel-map-enable').textContent = online ? 'Hide street map' : 'Show street map';
    if (!parcel) { online = false; map.reset(); $('parcel-location').textContent = ''; return; }
    for (const [label, value] of [['Status', statuses[parcel.status] ?? parcel.status], ['Parcel', `${parcel.description} · ${parcel.weightKg} kg`], ['Recipient', parcel.recipientName], ['Destination', parcel.destination], ['Reference', parcel.reference], ['Courier', parcel.driver?.name ?? 'Not assigned'], ['Vehicle', parcel.driver?.vehicle ? `${parcel.driver.vehicle.colour ?? ''} ${parcel.driver.vehicle.model} · ${parcel.driver.vehicle.plate}` : 'Not assigned']]) $('parcel-details').append(element('dt', label), element('dd', value));
    if (parcel.verifiedAt) $('parcel-details').append(element('dt', 'Handover verified'), element('dd', `${safetyTime(parcel.verifiedAt)} (WAT)`));
    const position = parcel.status === 'in_progress' ? parcel.location : null;
    const stale = !position || Boolean(position.stale) || now() - position.capturedAt > 60_000;
    $('parcel-location').textContent = position ? `${stale ? 'Last known location — update is stale' : 'Driver-shared location'}: ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)} · accuracy ±${Math.round(position.accuracy)} m · ${safetyTime(position.capturedAt)} (WAT).`
      : parcel.status === 'in_progress' ? 'Waiting for a fresh location from your courier. No position is estimated.' : parcel.status === 'completed' ? 'Delivery finished. Location sharing has ended.' : 'Location becomes available after parcel collection while the driver shares GPS.';
    map.render({ enabled: Boolean(online && settings?.enabled && position), tiles: settings?.tiles, driver: position, vehicle: parcel.driver?.vehicle, stale, focusKey: `${parcel.rideId}:${Boolean(position)}` });
    if (parcel.status === 'in_progress' && parcel.dropoffPin) { $('parcel-pin-panel').hidden = false; $('parcel-pin').textContent = parcel.dropoffPin; }
  }
  return Object.freeze({ render, tick() { if (current) render(current); } });
}
