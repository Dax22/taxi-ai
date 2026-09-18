import { formatNaira } from '/shared/demo-booking.mjs';
import { RIDE_STATUS_LABELS, CANCELLATION_REASONS } from '/shared/trip-lifecycle.mjs';
import { $, element } from './dom.mjs';
import { tripControls } from './trip-model.mjs';

export function createTripView({ onCommand, serverNow }) {
  let current = null, busy = false, rendered = '';

  function tick() {
    const controls = tripControls(current?.ride, current?.user, serverNow());
    $('trip-confirm').dataset.locked = String(!controls.confirm);
    $('trip-action').dataset.locked = String(!controls.next || controls.next.action === 'start');
    $('trip-start').dataset.locked = String(controls.next?.action !== 'start' || controls.pinLocked);
    $('cancel-request').dataset.locked = String(!controls.cancel);
    $('trip-cancel-submit').dataset.locked = String(!controls.cancel);
    $('pickup-pin-fields').disabled = busy || controls.next?.action !== 'start' || controls.pinLocked;
    $('trip-cancel-fields').disabled = busy || !controls.cancel;
    $('pickup-pin-lock').textContent = controls.pinLocked
      ? `PIN verification is paused. Try again in ${Math.ceil((current.ride.trip.pinBlockedUntil - serverNow()) / 1000)} seconds.` : '';
    for (const id of ['trip-confirm', 'trip-action', 'trip-start', 'cancel-request', 'trip-cancel-submit']) {
      const button = $(id); button.disabled = busy || button.dataset.locked === 'true';
    }
  }

  function render(ride, user) {
    const changed = current?.ride.id !== ride?.id || current?.user.id !== user?.id;
    current = ride && user ? { ride, user } : null;
    if (changed) {
      $('driver-pickup-pin').value = ''; $('trip-cancel-form').hidden = true;
      $('trip-cancel-reason').value = 'plans_changed'; rendered = '';
    }
    if (!current) { reset(); return; }
    const controls = tripControls(ride, user, serverNow());
    $('trip-panel').hidden = !ride.trip && ride.status !== 'agreed';
    $('trip-title').textContent = RIDE_STATUS_LABELS[ride.status];
    const hints = {
      agreed: user.role === 'customer'
        ? 'Review the fare and driver above, then confirm your test booking. Availability is checked when you confirm.'
        : 'Waiting for the customer to confirm the booking at the agreed fare.',
      booked: 'Booking confirmed. The driver can now mark that they are on their way.',
      on_way: 'The driver has marked that they are on their way. Coordinate pickup in your chat.',
      arrived: 'The driver has marked that they have arrived. Verify the vehicle before sharing the pickup PIN in person.',
      in_progress: 'Pickup PIN verified. The trip is in progress.',
      completed: 'Trip completed. Your fare and journey record are saved. No payment has been taken in this preview.',
      cancelled: 'This booking was cancelled. Its record and conversation remain available.',
    };
    $('trip-guidance').textContent = hints[ride.status] ?? '';
    $('trip-confirm').hidden = !controls.confirm;
    $('trip-confirm').textContent = ride.negotiation?.agreement
      ? `Confirm test booking · ${formatNaira(ride.negotiation.agreement.amountKobo)}` : 'Confirm booking';
    $('trip-confirm').onclick = () => onCommand(`/api/rides/${ride.id}/confirm`, { expectedVersion: ride.version }, 'Your test booking is confirmed.');
    $('trip-action').hidden = !controls.next || controls.next.action === 'start';
    $('trip-action').textContent = controls.next?.label ?? '';
    $('trip-action').onclick = controls.next ? () => onCommand(`/api/rides/${ride.id}/${controls.next.action}`,
      { expectedVersion: ride.version }, controls.next.to === 'completed' ? 'Trip completed. Your trip history is saved.' : 'Trip progress updated.') : null;
    $('pickup-pin-panel').hidden = !controls.pin;
    $('pickup-pin-value').textContent = controls.pin ?? '';
    $('pickup-pin-form').hidden = controls.next?.action !== 'start';
    if (controls.next?.action !== 'start') $('driver-pickup-pin').value = '';
    $('cancel-request').hidden = !controls.cancel;
    $('cancel-request').textContent = ride.trip ? 'Cancel booking' : 'Cancel request';
    if (!controls.cancel) $('trip-cancel-form').hidden = true;

    const key = JSON.stringify([ride.id, ride.activity]);
    if (key !== rendered) {
      rendered = key;
      $('trip-timeline').replaceChildren();
      $('trip-activity').hidden = !ride.activity?.length;
      for (const entry of ride.activity ?? []) {
        const actor = entry.actorId === ride.customer.id ? 'Customer' : 'Driver';
        const item = element('li');
        item.append(element('strong', `${RIDE_STATUS_LABELS[entry.type]} · ${actor}`));
        const time = element('time', new Date(entry.createdAt).toLocaleString());
        time.dateTime = new Date(entry.createdAt).toISOString(); item.append(time);
        if (entry.reason) item.append(element('span', CANCELLATION_REASONS[entry.reason]));
        $('trip-timeline').append(item);
      }
    }
    tick();
  }

  $('pickup-pin-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!current || busy) return;
    const { ride, user } = current;
    const controls = tripControls(ride, user, serverNow());
    if (controls.next?.action !== 'start' || controls.pinLocked) return;
    onCommand(`/api/rides/${ride.id}/start`, { expectedVersion: ride.version, pickupPin: $('driver-pickup-pin').value }, 'Pickup verified. Trip started.');
  });
  $('cancel-request').addEventListener('click', () => {
    if (!current || busy || !tripControls(current.ride, current.user, serverNow()).cancel) return;
    $('trip-cancel-form').hidden = false; $('trip-cancel-reason').focus();
  });
  $('trip-cancel-dismiss').addEventListener('click', () => { $('trip-cancel-form').hidden = true; });
  $('trip-cancel-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!current || busy) return;
    const { ride, user } = current;
    if (!tripControls(ride, user, serverNow()).cancel) return;
    onCommand(`/api/rides/${ride.id}/cancel`, { expectedVersion: ride.version, reason: $('trip-cancel-reason').value }, 'Cancellation saved.');
  });

  function reset() {
    current = null; rendered = '';
    $('pickup-pin-value').textContent = ''; $('driver-pickup-pin').value = '';
    $('pickup-pin-lock').textContent = ''; $('trip-timeline').replaceChildren();
    $('trip-panel').hidden = true; $('trip-activity').hidden = true; $('trip-cancel-form').hidden = true;
    $('pickup-pin-panel').hidden = true; $('pickup-pin-form').hidden = true;
  }
  return Object.freeze({ render, reset, tick, setBusy(value) { busy = value; tick(); } });
}
