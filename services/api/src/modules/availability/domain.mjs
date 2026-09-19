import { check } from '../../shared/errors.mjs';
import { fields } from '../../shared/validation.mjs';
import { DEMO_AREAS } from '../../../../../packages/shared/src/demo-booking.mjs';
import { insideAbuja } from '../../../../../packages/shared/src/locations.mjs';
import { POSITION_MS } from '../../../../../packages/shared/src/matching.mjs';

export function commandKey(value) {
  check(typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value), 'INVALID_IDEMPOTENCY_KEY', 'A unique availability command key is required.');
}
export function clientIdentity(value) {
  check(typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value), 'INVALID_AVAILABILITY_CLIENT', 'Use availability controls in this window.');
  return value;
}
export function sequence(value) {
  check(Number.isSafeInteger(value) && value > 0, 'INVALID_LOCATION', 'A positive location sequence is required.');
}
export function position(value, now) {
  fields(value, ['lat', 'lng', 'accuracy', 'capturedAt']);
  check(insideAbuja(value), 'INVALID_LOCATION', 'Your location is outside the Abuja preview area. Use an Abuja device for GPS matching.');
  check(Number.isFinite(value.accuracy) && value.accuracy > 0 && value.accuracy <= 200, 'INVALID_LOCATION', 'Wait for a GPS fix accurate to within 200 metres.');
  check(Number.isSafeInteger(value.capturedAt) && value.capturedAt <= now + 5000 && value.capturedAt > now - POSITION_MS,
    'INVALID_LOCATION', 'A fresh GPS fix is required to go online.');
  return { lat: Number(value.lat.toFixed(6)), lng: Number(value.lng.toFixed(6)), accuracy: Math.ceil(value.accuracy), capturedAt: value.capturedAt };
}
export function startData(data, now, allowSimulation) {
  check(['gps', 'sample'].includes(data?.mode), 'INVALID_AVAILABILITY_MODE', 'Choose GPS or local sample-area matching.');
  if (data.mode === 'sample') {
    fields(data, ['mode', 'areaId']);
    check(allowSimulation, 'FORBIDDEN', 'Sample-area matching is available only in local development.');
    check(DEMO_AREAS.some((area) => area.id === data.areaId), 'INVALID_LOCATION', 'Choose a sample area.');
    return { mode: 'sample', areaId: data.areaId, position: null };
  }
  fields(data, ['mode', 'position']);
  return { mode: 'gps', areaId: null, position: position(data.position, now) };
}
