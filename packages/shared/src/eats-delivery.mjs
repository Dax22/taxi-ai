import { insideNigeria } from './locations.mjs';
import { resolveFoodArea } from './nigeria-areas.mjs';
import { guestPhone } from './guest-rides.mjs';

export const OUTSIDE_NIGERIA_FOOD_MESSAGE = 'Your current location is outside Nigeria. Enter a delivery address in Nigeria to order for yourself or someone else.';
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => record(value) && Object.keys(value).every((key) => keys.includes(key));
const text = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max && !/[\p{Cc}\p{Cf}]/u.test(value);

/** A selected point is a delivery aid, never proof of a home or postal address. */
export function normalizeFoodPoint(point) {
  if (!only(point, ['lat', 'lng']) || typeof point.lat !== 'number' || typeof point.lng !== 'number' || !insideNigeria(point)) throw new Error('Choose a delivery point within Nigeria, or enter the address without a map pin.');
  return { lat: Number(point.lat.toFixed(6)), lng: Number(point.lng.toFixed(6)) };
}
export function normalizeFoodAddress(value) {
  if (!only(value, ['line', 'areaId', 'point']) || !text(value.line, 8, 240) || !resolveFoodArea(value.areaId)) throw new Error('Enter the delivery street, building and landmark, then choose a Nigerian state and town or area.');
  return { line: value.line.trim(), areaId: value.areaId,
    ...(Object.hasOwn(value, 'point') ? { point: value.point == null ? null : normalizeFoodPoint(value.point) } : {}) };
}
export function normalizeFoodRecipient(value, accountName = '') {
  value ??= { kind: 'self' };
  if (!only(value, ['kind', 'name', 'phone']) || !['self', 'other'].includes(value.kind)) throw new Error('Choose whether this food is for yourself or someone else.');
  if (Object.hasOwn(value, 'phone') && typeof value.phone !== 'string') throw new Error('Enter the recipient’s phone number as text.');
  const name = value.kind === 'self' ? (accountName || value.name || 'Me') : value.name;
  if (!text(name, value.kind === 'self' ? 1 : 2, 100)) throw new Error('Enter the recipient’s name (2–100 characters).');
  let phone = '';
  if (value.kind === 'other' || value.phone) {
    try { phone = guestPhone(value.phone); }
    catch { throw new Error('Enter the recipient’s phone number with a country code, or an 11-digit Nigerian mobile number.'); }
  }
  return { kind: value.kind, name: name.trim(), phone };
}
