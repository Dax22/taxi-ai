import { createApiClient } from './dashboard/api-client.mjs';
import { createTripShareController } from './dashboard/trip-share-controller.mjs';
import { $, element } from './dashboard/dom.mjs';
import { safetyTime, safetyLocation } from './dashboard/safety-format.mjs';
import { RIDE_STATUS_LABELS } from '/shared/trip-lifecycle.mjs';

// Fragments are not sent in HTTP requests. Remove it from this history entry immediately.
let token = location.hash.slice(1);
history.replaceState(null, '', '/trip-share');
let serverTime = { now: Date.now(), received: performance.now() };
const client = createApiClient({ onServerTime(now) { serverTime = { now, received: performance.now() }; } });
const viewer = createTripShareController({ client, token, now: () => serverTime.now + performance.now() - serverTime.received,
  view: { render({ data, message }) {
    $('shared-message').textContent = message; $('shared-details').replaceChildren(); $('shared-card').hidden = !data;
    if (!data) return;
    const { trip } = data;
    for (const [label, value] of [['Route', `${trip.pickup} → ${trip.destination}`], ['Trip', trip.reference],
      ['Status', RIDE_STATUS_LABELS[trip.status]], ['Driver', trip.driver.name],
      ['Vehicle / plate', `${trip.driver.vehicle.model} · ${trip.driver.vehicle.plate}`],
      ['Last shared location', safetyLocation(trip.location)], ['Link expires', `${safetyTime(data.expiresAt)} (Abuja)`]]) {
      $('shared-details').append(element('dt', label), element('dd', value));
    }
  } },
});
token = ''; // The viewer owns the only retained secret and clears it on page exit.
const poll = () => { if (!document.hidden) void viewer.poll(); };
$('shared-refresh').addEventListener('click', poll);
document.addEventListener('visibilitychange', () => { if (document.hidden) viewer.suspend(); else poll(); });
window.addEventListener('pagehide', () => viewer.close());
setInterval(poll, 10_000); setInterval(() => viewer.tick(), 1000); poll();
