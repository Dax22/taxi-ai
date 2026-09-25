import { $, element } from '../dashboard/dom.mjs';
import { createMapView } from '../dashboard/map-view.mjs';
import { RIDE_STATUS_LABELS } from '/shared/trip-lifecycle.mjs';

const when = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
const status = value => value === 'completed' ? 'Driver marked trip completed' : RIDE_STATUS_LABELS[value] ?? value;
const place = value => typeof value === 'string' ? value : value?.name ?? 'Unavailable';
export function familyDeliveryStatus(delivery) {
  return ({ saved: 'Saved in app', queued: 'Notification queued', provider_accepted: 'Accepted by notification service', delivered: 'Delivery confirmed by provider', failed: 'Notification failed', suppressed: 'Notification stopped' })[delivery?.status] ?? 'Saved in app';
}
export function familyLocationStatus(trip, now) {
  if (!trip?.sharingActive) return 'Live vehicle access has ended. Previous location details are cleared.';
  if (!trip.location) return 'Vehicle location unavailable. The driver may not be sharing, or an update may be delayed.';
  const age = Math.max(0, Math.floor((now - trip.location.capturedAt) / 1000));
  if (trip.location.stale || age >= 30) return `Vehicle location is stale · last update ${age}s ago. The previous map position has been cleared.`;
  return `Vehicle location · updated ${age}s ago · reported accuracy ±${Math.round(trip.location.accuracy)} m. This is the vehicle’s position, not the passenger’s phone.`;
}
export function createFamilyView({ onCommand, onSelect, onClose, onMaps }) {
  const map = createMapView($('family-map'));
  let state = null, mapEnabled = false, detailId = null;
  const button = (label, action, primary = false) => {
    const node = element('button', label, `button ${primary ? 'button-primary' : 'button-outline'} button-small`);
    node.type = 'button'; node.disabled = state?.busy ?? false; node.addEventListener('click', action); return node;
  };
  function action(row, label, name, data, primary = false) {
    let group = row.querySelector('.family-actions');
    if (!group) { group = element('div', undefined, 'family-actions'); row.append(group); }
    group.append(button(label, () => onCommand(name, data), primary));
  }
  function confirm(row, label, explanation, name, data) {
    const group = element('div', undefined, 'family-actions');
    group.append(button(label, () => {
      const box = element('div', undefined, 'family-confirmation');
      box.append(element('p', explanation), button('Confirm', () => onCommand(name, data)), button('Keep sharing', () => box.remove()));
      row.append(box);
    })); row.append(group);
  }
  function choices(root, items, placeholder) {
    const current = root.value; root.replaceChildren();
    const prompt = element('option', placeholder); prompt.value = ''; root.append(prompt);
    for (const [value, label] of items) { const option = element('option', label); option.value = value; root.append(option); }
    if (items.some(([value]) => value === current)) root.value = current;
  }
  function contacts(family) {
    $('family-contacts').replaceChildren();
    for (const contact of family.contacts) {
      if (['revoked', 'declined', 'expired'].includes(contact.status)) continue;
      const row = element('article', undefined, 'family-row');
      row.append(element('h3', contact.name || 'Invitation'), element('p', contact.direction === 'watching' ? 'They choose which trips you can view.' : 'You choose which trips they can view.'));
      if (contact.status === 'pending') {
        row.append(element('p', `Invitation pending · expires ${when(contact.expiresAt)}`));
        if (contact.direction === 'watching') {
          const label = element('label', undefined, 'family-checkbox'), checkbox = element('input'); checkbox.type = 'checkbox';
          label.append(checkbox, element('span', 'I confirm I am 18 or older and accept this connection.')); row.append(label);
          const accept = button('Accept invitation', () => { if (checkbox.checked) onCommand('accept', { contactId: contact.id, expectedVersion: contact.version, adultConfirmed: true }); }, true);
          accept.disabled = true; checkbox.addEventListener('change', () => { accept.disabled = !checkbox.checked || state.busy; }); row.append(accept);
          action(row, 'Decline', 'decline', { contactId: contact.id, expectedVersion: contact.version });
        } else action(row, 'Cancel invitation', 'revoke-contact', { contactId: contact.id, expectedVersion: contact.version });
      } else {
        row.append(element('p', 'Connection accepted · sharing is selected per trip.'));
        confirm(row, 'Remove connection', 'This stops this connection’s access to shared trips immediately.', 'revoke-contact', { contactId: contact.id, expectedVersion: contact.version });
      }
      $('family-contacts').append(row);
    }
    if (!$('family-contacts').children.length) $('family-contacts').append(element('p', 'Your accepted connections and invitations will appear here.', 'empty-state'));
    const contacts = family.contacts.filter(contact => contact.canShare);
    choices($('family-contact'), contacts.map(contact => [contact.id, contact.name]), 'Choose a connection');
    choices($('family-ride'), family.availableTrips.map(ride => [ride.rideId, `${place(ride.pickup)} → ${place(ride.destination)} · ${status(ride.status)}`]), 'Choose your trip');
    const available = contacts.length > 0 && family.availableTrips.length > 0;
    $('family-share-form').hidden = !available;
    $('family-share-empty').textContent = !contacts.length ? 'An accepted connection is needed before you can share a trip.' : !family.availableTrips.length ? 'Your confirmed, active trips booked for yourself will appear here.' : '';
  }
  function journeys(family) {
    $('family-trips').replaceChildren(); $('family-trip-count').textContent = `${family.trips.filter(trip => trip.sharingActive).length} active`;
    for (const trip of family.trips) {
      const owner = trip.relationship === 'sharing_with';
      const row = element('article', undefined, 'family-row');
      row.append(element('h3', owner ? `Sharing with ${trip.name}` : `${trip.name}’s journey`), element('p', status(trip.status)));
      row.append(element('p', trip.safeArrivalAt ? `Passenger confirmed safe arrival · ${when(trip.safeArrivalAt)}` : trip.status === 'completed' ? 'Passenger has not confirmed safe arrival.' : trip.sharingActive ? 'Live access is active for this trip.' : 'Live access has ended.'));
      if (trip.checkIn) {
        const pending = trip.checkIn.requestedAt !== null && (trip.checkIn.respondedAt === null || trip.checkIn.requestedAt > trip.checkIn.respondedAt);
        if (pending) row.append(element('p', `Check-in requested ${when(trip.checkIn.requestedAt)} · awaiting a response. An unanswered request does not confirm an emergency.`));
        if (trip.checkIn.response) row.append(element('p', `${pending ? 'Previous response: ' : ''}${trip.checkIn.response === 'help' ? 'Passenger requested help. Contact them directly; emergency assistance is not automatically dispatched.' : trip.checkIn.response === 'okay' ? 'Passenger said “I’m okay”' : 'Passenger confirmed safe arrival.'} · ${when(trip.checkIn.respondedAt)}`, trip.checkIn.response === 'help' ? 'family-help' : ''));
      }
      const details = element('div', undefined, 'family-actions'); details.append(button('View journey', () => onSelect(trip.shareId))); row.append(details);
      const version = { shareId: trip.shareId, expectedVersion: trip.version };
      if (trip.canRequestCheckIn) action(row, 'Request a check-in', 'request-check-in', version);
      if (owner && trip.canRespond) {
        action(row, 'I’m okay', 'respond', { ...version, response: 'okay' });
      }
      if (owner && trip.canRequestHelp) action(row, 'I need help', 'respond', { ...version, response: 'help' }, true);
      if (owner && trip.canConfirmArrival && !trip.safeArrivalAt) action(row, 'I’ve arrived safely', 'respond', { ...version, response: 'arrived' }, true);
      if (owner) confirm(row, trip.sharingActive ? 'Stop sharing' : 'Remove shared summary', trip.sharingActive ? 'This person will immediately lose access to your trip and vehicle location.' : 'This person will immediately lose access to this completed trip summary.', 'stop-sharing', version);
      $('family-trips').append(row);
    }
    if (!family.trips.length) $('family-trips').append(element('p', 'No journeys are shared right now. Your next trip can be shared after a connection accepts your invitation.', 'empty-state'));
  }
  function inbox(family) {
    $('family-inbox').replaceChildren();
    for (const event of family.inbox) {
      const row = element('article', undefined, 'family-row'); row.append(element('h3', event.title), element('p', when(event.createdAt)), element('p', `${familyDeliveryStatus(event.delivery)}${event.delivery?.acceptedAt ? ` · ${when(event.delivery.acceptedAt)}` : ''}`), element('p', event.state === 'acknowledged' ? `Acknowledged by you in app · ${when(event.acknowledgedAt)}` : 'Not yet acknowledged'));
      if (event.shareId && family.trips.some(trip => trip.shareId === event.shareId)) {
        const navigation = element('div', undefined, 'family-actions'); navigation.append(button('Review shared trip', () => onSelect(event.shareId))); row.append(navigation);
      }
      if (event.state !== 'acknowledged') action(row, 'Acknowledge', 'acknowledge', { eventId: event.id });
      $('family-inbox').append(row);
    }
    if (!family.inbox.length) $('family-inbox').append(element('p', 'Journey updates and check-ins will appear here.', 'empty-state'));
  }
  function location(trip, now) {
    $('family-location-status').textContent = familyLocationStatus(trip, now);
    const fresh = trip?.sharingActive && trip.location && !trip.location.stale && now - trip.location.capturedAt < 30_000;
    const enabled = Boolean(fresh && mapEnabled && state?.settings?.enabled && state.settings.tiles);
    $('family-map').hidden = $('family-map-attribution').hidden = !enabled;
    $('family-maps-toggle').hidden = !fresh;
    $('family-maps-toggle').textContent = mapEnabled ? 'Turn off street map' : 'Enable street map';
    $('family-map-note').textContent = state?.settings ? state.settings.enabled ? `Street tiles load through ${state.settings.tileHost}. Enabling the map shares the visible map area with that provider.` : 'Street maps are unavailable. The location timestamp and accuracy remain above.' : fresh ? 'Street maps are optional. Enabling them loads this vehicle’s map area through the configured map provider.' : '';
    if (enabled) map.render({ enabled: true, tiles: state.settings.tiles, driver: trip.location, vehicle: trip.driver?.vehicle, focusKey: trip.shareId, stale: false });
    else map.reset();
  }
  function detail(trip, now) {
    $('family-detail').hidden = !trip; $('family-detail-copy').replaceChildren();
    if (!trip) { map.reset(); mapEnabled = false; detailId = null; $('family-location-status').textContent = ''; return; }
    if (detailId !== trip.shareId) { detailId = trip.shareId; mapEnabled = false; }
    const details = element('dl');
    const rows = [[trip.passengerName || trip.relationship === 'watching' ? 'Passenger' : 'Shared with', trip.passengerName ?? trip.name], ['Trip progress', status(trip.status)], ['Safe arrival', trip.safeArrivalAt ? `Confirmed by passenger · ${when(trip.safeArrivalAt)}` : 'Not confirmed by passenger']];
    if (trip.sharingActive) {
      rows.push(['Pickup', place(trip.pickup)], ['Destination', place(trip.destination)]);
      if (trip.driver) rows.push(['Driver', trip.driver.name], ['Vehicle', `${trip.driver.vehicle?.colour ?? ''} ${trip.driver.vehicle?.model ?? ''} · ${trip.driver.vehicle?.plate ?? 'Number plate unavailable'}`.trim()]);
    }
    for (const [label, value] of rows) details.append(element('dt', label), element('dd', value));
    $('family-detail-copy').append(details); location(trip, now);
  }
  $('family-close-trip').addEventListener('click', onClose);
  $('family-maps-toggle').addEventListener('click', () => { mapEnabled = !mapEnabled; if (mapEnabled && !state?.settings) onMaps(); else if (state) location(state.trip, state.now); });
  return Object.freeze({
    render(next) {
      state = next; $('family-status').textContent = next.message; $('family-error').textContent = next.error;
      $('family-private').hidden = !next.family; $('family-signin').hidden = next.signedIn || next.busy;
      $('family-logout').hidden = !next.signedIn; $('family-logout').disabled = $('family-refresh').disabled = next.busy;
      if (!next.family) {
        for (const id of ['family-contacts', 'family-trips', 'family-inbox', 'family-ride', 'family-contact']) $(id).replaceChildren();
        $('family-email').value = ''; $('family-adult').checked = false; detail(null, next.now); return;
      }
      contacts(next.family); journeys(next.family); inbox(next.family); detail(next.trip, next.now);
      for (const form of [$('family-invite-form'), $('family-share-form')]) for (const control of form.elements) control.disabled = next.busy;
    },
    tick(trip, now) { if (trip && state?.family) location(trip, now); },
  });
}
