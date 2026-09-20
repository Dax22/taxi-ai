import { DEMO_AREAS } from '/shared/demo-booking.mjs';
import { $, element } from './dom.mjs';

export function createAvailabilityView({ onOnline, onOffline }) {
  for (const area of DEMO_AREAS) {
    const option = element('option', area.name); option.value = area.id; $('availability-area').append(option);
  }
  $('availability-online').addEventListener('click', () => onOnline('gps'));
  $('availability-sample-online').addEventListener('click', () => onOnline('sample', $('availability-area').value));
  $('availability-offline').addEventListener('click', onOffline);
  function render({ user, busy, availability, online, settings, pending, running, ending, error, supported }) {
    $('availability-panel').hidden = user?.role !== 'driver';
    const approved = user?.driver?.status === 'approved' && user.driver.eligibility?.eligible;
    $('availability-status').textContent = pending ? 'Getting ready…' : ending ? 'Going offline…'
      : busy ? 'On a request' : online ? availability.mode === 'sample' ? 'Online · sample area' : 'Online' : 'Offline';
    const area = DEMO_AREAS.find((item) => item.id === availability?.areaId)?.name;
    $('availability-guidance').textContent = !approved ? 'Complete your application and keep reviewed documents current before going online.'
      : busy ? 'Finish your negotiation or trip, then choose Go online for another request.'
        : online && availability.mode === 'sample' ? `Local simulation: matching sample pickups in ${area ?? 'your selected area'}.`
          : online ? availability.owned && running ? 'Looking for nearby pickups. Keep this page open to stay online.'
            : 'You are online in another window. You can go offline here.'
            : 'Go online when you are ready to respond to requests.';
    $('availability-error').textContent = error;
    $('availability-online').disabled = !approved || busy || pending || ending || Boolean(availability?.online) || !settings || !supported;
    $('availability-online').hidden = Boolean(availability?.online) || pending;
    $('availability-offline').hidden = !availability?.online && !pending;
    $('availability-offline').disabled = ending;
    $('availability-offline').textContent = pending ? 'Cancel going online' : 'Go offline';
    $('availability-sample').hidden = !settings?.allowSimulation || Boolean(availability?.online) || pending;
    $('availability-sample-online').disabled = !approved || busy || ending;
    $('availability-area').disabled = busy || pending || ending;
    $('availability-device-note').hidden = supported;
  }
  return Object.freeze({ render });
}
