import { formatNaira } from '/shared/demo-booking.mjs';
import { RIDE_STATUS_LABELS, CANCELLATION_REASONS } from '/shared/trip-lifecycle.mjs';
import { $, element } from './dom.mjs';
import { tripControls } from './trip-model.mjs';
import { arrivalNotice } from '/shared/pickup-identity.mjs';

export function createTripView({ onCommand, serverNow, onVehicleMismatch = () => {} }) {
  let current = null, busy = false, rendered = '';

  function tick() {
    const controls = tripControls(current?.ride, current?.user, serverNow());
    const delivery = current?.ride.delivery, completing = delivery && controls.next?.action === 'complete';
    const deliveryLocked = Boolean(delivery?.pinBlockedUntil > serverNow());
    $('delivery-pin-fields').disabled = busy || !completing || deliveryLocked;
    $('delivery-complete').dataset.locked = String(!completing || deliveryLocked);
    $('delivery-pin-lock').textContent = deliveryLocked ? `Code verification is paused. Try again in ${Math.ceil((delivery.pinBlockedUntil - serverNow()) / 1000)} seconds.` : '';
    $('trip-confirm').dataset.locked = String(!controls.confirm);
    $('trip-action').dataset.locked = String(!controls.next || controls.next.action === 'start');
    $('trip-start').dataset.locked = String(controls.next?.action !== 'start' || controls.pinLocked);
    $('cancel-request').dataset.locked = String(!controls.cancel);
    $('trip-cancel-submit').dataset.locked = String(!controls.cancel);
    $('vehicle-mismatch-report').disabled = busy;
    $('vehicle-mismatch-report').dataset.locked = String(busy);
    $('pickup-pin-fields').disabled = busy || controls.next?.action !== 'start' || controls.pinLocked;
    $('trip-cancel-fields').disabled = busy || !controls.cancel;
    $('pickup-pin-lock').textContent = controls.pinLocked
      ? `PIN verification is paused. Try again in ${Math.ceil((current.ride.trip.pinBlockedUntil - serverNow()) / 1000)} seconds.` : '';
    for (const id of ['trip-confirm', 'trip-action', 'trip-start', 'delivery-complete', 'cancel-request', 'trip-cancel-submit']) {
      const button = $(id); button.disabled = busy || button.dataset.locked === 'true';
    }
  }

  function render(ride, user) {
    const changed = current?.ride.id !== ride?.id || current?.user.id !== user?.id;
    current = ride && user ? { ride, user } : null;
    if (changed) {
      $('driver-pickup-pin').value = ''; $('driver-delivery-pin').value = ''; $('trip-cancel-form').hidden = true;
      $('trip-cancel-reason').value = 'plans_changed'; rendered = '';
    }
    if (!current) { reset(); return; }
    const controls = tripControls(ride, user, serverNow());
    $('trip-panel').hidden = !ride.trip && ride.status !== 'agreed';
    $('trip-title').textContent = ride.delivery && ride.status === 'completed' ? 'Delivered' : RIDE_STATUS_LABELS[ride.status];
    const pickupCheck = ride.customer.id === user.id && ride.driver && ['booked','on_way','arrived'].includes(ride.status);
    $('pickup-identity').hidden = !pickupCheck;
    const notice = pickupCheck && ride.status === 'arrived' ? arrivalNotice(ride.driver) : null;
    const guest = ride.passenger?.kind === 'guest';
    const heading = notice?.title ?? 'Check your pickup vehicle';
    const body = guest ? (notice?.body ?? '').replace('Check the vehicle before sharing your pickup PIN.', 'Ask your friend to check the vehicle at pickup before they give the driver their PIN.') : notice?.body ?? '';
    if ($('arrival-title').textContent !== heading) $('arrival-title').textContent = heading;
    if ($('arrival-body').textContent !== body) $('arrival-body').textContent = body;
    $('pickup-identity-help').textContent = guest
      ? 'Ask your friend to compare the driver, number plate, make/model and colour at pickup. If anything differs, they must not board or share their PIN.'
      : 'Compare the number plate, make/model and colour. If anything differs, do not board, hand over a parcel or share your pickup PIN.';
    $('vehicle-photo-guidance').textContent = guest
      ? 'Use a clear photo from your friend at the actual pickup, showing one vehicle and its whole plate. This optional check compares it with the assigned vehicle.'
      : 'Take a clear photo of one vehicle at the actual pickup with its whole number plate visible. This optional check compares the photo with your assigned vehicle.';
    $('pickup-pin-guidance').textContent = guest
      ? 'Send the private trip link to your friend. They give the driver this PIN only at the vehicle after checking the driver and number plate. Do not send the PIN to the driver remotely.'
      : 'Share this with your driver in person after checking the vehicle. Keep it private until pickup.';
    const hints = {
      agreed: user.role === 'customer'
        ? 'Review the fare and driver above, then confirm your test booking. Availability is checked when you confirm.'
        : 'Waiting for the customer to confirm the booking at the agreed fare.',
      booked: 'Booking confirmed. The driver can now mark that they are on their way.',
      on_way: 'The driver has marked that they are on their way. Coordinate pickup in your chat.',
      arrived: guest ? 'The driver has marked that they have arrived. The passenger verifies the driver and vehicle, then gives the driver their PIN at pickup.'
        : 'The driver has marked that they have arrived. Verify the vehicle before sharing the pickup PIN in person.',
      in_progress: 'Pickup PIN verified. The trip is in progress.',
      completed: 'Trip completed. Your fare and journey record are saved. No payment has been taken in this preview.',
      cancelled: 'This booking was cancelled. Its record and conversation remain available.',
    };
    $('trip-guidance').textContent = ride.delivery && ride.status === 'in_progress' ? 'Parcel collected. The sender shares the drop-off code with the recipient; the driver verifies it at handover.'
      : ride.delivery && ride.status === 'completed' ? 'Delivery verified. The agreed fare and handover record are saved.' : hints[ride.status] ?? '';
    $('pickup-pin-help').textContent = ride.delivery ? 'Ask the sender for the pickup PIN only after confirming the parcel fits your vehicle and you have collected it.'
      : guest ? `Ask the passenger, ${ride.passenger.name}, for their PIN when they are at the vehicle. The person who booked may be elsewhere.` : 'Ask the customer for their PIN when they are at the vehicle.';
    $('trip-start').textContent = ride.delivery ? 'Verify PIN and collect parcel' : 'Verify PIN and start trip';
    $('delivery-pin-panel').hidden = !ride.delivery?.dropoffPin;
    $('delivery-pin-value').textContent = ride.delivery?.dropoffPin ?? '';
    $('delivery-pin-form').hidden = !ride.delivery || controls.next?.action !== 'complete';
    if (!ride.delivery || controls.next?.action !== 'complete') $('driver-delivery-pin').value = '';
    $('trip-confirm').hidden = !controls.confirm;
    $('trip-confirm').textContent = ride.negotiation?.agreement
      ? `Confirm ride · ${formatNaira(ride.negotiation.agreement.amountKobo)}` : 'Confirm ride';
    $('trip-confirm').onclick = () => onCommand(`/api/rides/${ride.id}/confirm`, { expectedVersion: ride.version },
      'Ride confirmed at the agreed fare. Your driver can now begin the pickup journey.');
    $('trip-action').hidden = !controls.next || controls.next.action === 'start' || (ride.delivery && controls.next.action === 'complete');
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
  $('vehicle-mismatch-report').addEventListener('click', () => {
    if (current && !busy && current.ride.customer.id === current.user.id && ['booked','on_way','arrived'].includes(current.ride.status)) onVehicleMismatch(current.ride.id);
  });
  $('delivery-pin-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!current || busy || !current.ride.delivery) return;
    const { ride, user } = current;
    if (tripControls(ride, user, serverNow()).next?.action !== 'complete' || ride.delivery.pinBlockedUntil > serverNow()) return;
    onCommand(`/api/rides/${ride.id}/complete`, { expectedVersion: ride.version, deliveryPin: $('driver-delivery-pin').value }, 'Delivery verified and completed.');
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
    $('pickup-identity').hidden = true; $('arrival-title').textContent = ''; $('arrival-body').textContent = '';
    $('delivery-pin-value').textContent = ''; $('driver-delivery-pin').value = ''; $('delivery-pin-lock').textContent = '';
    $('delivery-pin-panel').hidden = true; $('delivery-pin-form').hidden = true;
    $('pickup-pin-value').textContent = ''; $('driver-pickup-pin').value = '';
    $('pickup-pin-lock').textContent = ''; $('trip-timeline').replaceChildren();
    $('pickup-pin-help').textContent = 'Ask the passenger for their PIN when they are at the vehicle.';
    $('trip-panel').hidden = true; $('trip-activity').hidden = true; $('trip-cancel-form').hidden = true;
    $('pickup-pin-panel').hidden = true; $('pickup-pin-form').hidden = true;
  }
  return Object.freeze({ render, reset, tick, setBusy(value) { busy = value; tick(); } });
}
