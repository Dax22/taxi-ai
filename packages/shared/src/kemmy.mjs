import { distanceMeters } from './locations.mjs';
import { vehiclePresentation } from './vehicle-profile.mjs';

const minutes = (seconds) => Math.max(1, Math.ceil(seconds / 60));
const firstName = (name) => name?.trim().split(/\s+/)[0] || 'Your driver';

/** Copy and ETAs depend only on saved trip state, route geometry and a recent GPS fix. */
export function kemmyUpdate(ride, { position = null, now = Date.now(), stale = true } = {}) {
  if (!ride?.driver || ride.service === 'delivery' || ride.delivery) return null;
  const name = firstName(ride.driver.name);
  const vehicle = ride.driver.vehicle ?? {};
  const model = vehiclePresentation(vehicle).title || 'car';
  const description = [vehicle.colour?.trim(), model].filter(Boolean).join(' ');
  const route = ride.route;
  const tripMinutes = Number.isFinite(route?.durationSeconds) && route.durationSeconds > 0
    ? minutes(Math.max(60, route.durationSeconds - (ride.status === 'in_progress' && Number.isFinite(ride.startedAt ?? ride.trip?.startedAt)
      ? Math.max(0, (now - (ride.startedAt ?? ride.trip.startedAt)) / 1000) : 0))) : null;
  const pickupMinutes = ride.status === 'on_way' && !stale && position && route?.pickup && Number.isFinite(position.lat) && Number.isFinite(position.lng)
    ? minutes(distanceMeters(position, route.pickup) / (24_000 / 3600)) : null;
  if (ride.status === 'booked' || ride.status === 'on_way') return {
    phase: 'pickup', pickupMinutes, tripMinutes,
    message: `${name} ${ride.status === 'on_way' ? 'is on the way' : 'is assigned to your ride'} in a ${description}.${pickupMinutes ? ` Estimated pickup in about ${pickupMinutes} min.` : ride.status === 'booked' ? ' Pickup ETA will appear when the driver is on the way and shares a recent location.' : ' Pickup ETA will appear when a recent driver location is available.'}`,
    note: pickupMinutes ? 'Pickup estimate uses straight-line distance and a fixed 24 km/h speed; roads and traffic may change it.' : '',
  };
  if (ride.status === 'arrived') return { phase: 'arrived', pickupMinutes: null, tripMinutes,
    message: `${name} has arrived in a ${description}. Check the vehicle and number plate before sharing your pickup PIN.${tripMinutes ? ` Once your ride starts, you should reach ${ride.destination?.name ?? ride.destination} in approximately ${tripMinutes} min, based on the planned map route.` : ''}`,
    note: tripMinutes ? 'Travel time comes from the saved road route and excludes live traffic.' : '' };
  if (ride.status === 'in_progress') return { phase: 'trip', pickupMinutes: null, tripMinutes,
    message: tripMinutes ? `You should reach ${ride.destination?.name ?? ride.destination} in approximately ${tripMinutes} min, based on the planned map route.`
      : `Your trip to ${ride.destination?.name ?? ride.destination} is in progress. A map ETA is not available for this journey.`,
    note: tripMinutes ? 'This estimate counts down from the saved route time; it does not include live traffic.' : '' };
  if (ride.status === 'completed') return { phase: 'rate', pickupMinutes: null, tripMinutes: null,
    message: ride.rating ? `Thanks for riding with ${name}. You rated your driver ${ride.rating} out of 5 stars.` : `You have arrived. How would you rate ${name}, your driver?`, note: '' };
  return null;
}
