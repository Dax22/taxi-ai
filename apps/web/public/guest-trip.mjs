import { createApiClient } from './dashboard/api-client.mjs';
import { createGuestTripController } from './dashboard/guest-trip-controller.mjs';
import { $, element } from './dashboard/dom.mjs';
import { safetyTime, safetyLocation } from './dashboard/safety-format.mjs';
import { RIDE_STATUS_LABELS } from '/shared/trip-lifecycle.mjs';

// Remove the capability before doing any network work; fragments are never sent to the server.
let token = location.hash.slice(1);
history.replaceState(null, '', '/guest-trip');
let serverTime = { now: Date.now(), received: performance.now() };
const client = createApiClient({ onServerTime(now) { serverTime = { now, received: performance.now() }; } });
const viewer = createGuestTripController({ client, token, now: () => serverTime.now + performance.now() - serverTime.received,
  view: { render({ data, message, loading }) {
    $('guest-message').textContent = message; $('guest-details').replaceChildren(); $('guest-card').hidden = !data;
    $('guest-refresh').disabled = loading; $('guest-refresh').setAttribute('aria-busy', String(loading));
    $('guest-pin-panel').hidden = true; $('guest-pin').textContent = '';
    if (!data) return;
    const trip = data.guestTrip;
    for (const [label, value] of [['Passenger', trip.passengerName], ['Booked by', trip.bookerName],
      ['Pickup', trip.pickup], ['Destination', trip.destination], ['Trip', trip.reference],
      ['Status', RIDE_STATUS_LABELS[trip.status]], ['Driver', trip.driver.name],
      ['Vehicle / plate', `${trip.driver.vehicle.colour ?? ''} ${trip.driver.vehicle.model} · ${trip.driver.vehicle.plate}`.trim()],
      ['Last shared location', safetyLocation(trip.location)], ['Link expires', `${safetyTime(data.expiresAt)} (Abuja)`]]) {
      $('guest-details').append(element('dt', label), element('dd', value));
    }
    if (trip.pickupPin && ['booked', 'on_way', 'arrived'].includes(trip.status)) {
      $('guest-pin').textContent = trip.pickupPin; $('guest-pin-panel').hidden = false;
    }
  } },
});
token = '';
const poll = () => { if (!document.hidden) void viewer.poll(); };
$('guest-refresh').addEventListener('click', poll);
document.addEventListener('visibilitychange', () => { if (document.hidden) viewer.suspend(); else void viewer.resume(); });
window.addEventListener('pagehide', () => viewer.close());
setInterval(poll, 10_000); setInterval(() => viewer.tick(), 1000);
if (document.hidden) viewer.suspend(); else poll();
