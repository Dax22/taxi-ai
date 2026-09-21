import { envelope } from '../../../../packages/shared/src/mobile-contracts.mjs';
import type { Position } from '../../../../packages/shared/src/mobile-journeys.mjs';
export type { Position } from '../../../../packages/shared/src/mobile-journeys.mjs';

export interface LocationShare {
  id: string; rideId: string; active: boolean; owned: boolean; sequence: number;
  startedAt: number; updatedAt: number | null; stale: boolean; position: Position | null;
}
export interface Tracking { rideId: string; canShare: boolean; isDriver: boolean; share: LocationShare | null; serverNow: number }
export interface TrackingResult { share: LocationShare; replayed: boolean; serverNow: number }
const object = (v: any) => v !== null && typeof v === 'object' && !Array.isArray(v);
const id = (v: any) => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v);
const time = (v: any) => Number.isSafeInteger(v) && v >= 0;
function check(value: any): asserts value {
  if (!value) throw new Error('Taxi Ai returned an incompatible location response. Refresh and try again.');
}
function share(v: any) {
  check(object(v) && id(v.id) && id(v.rideId) && typeof v.active === 'boolean' && typeof v.owned === 'boolean'
    && time(v.sequence) && time(v.startedAt) && (v.updatedAt === null || time(v.updatedAt)) && typeof v.stale === 'boolean');
  const p = v.position;
  check(p === null || object(p) && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90
    && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180 && Number.isFinite(p.accuracy)
    && p.accuracy > 0 && p.accuracy <= 200 && time(p.capturedAt));
  check((p === null) === (v.updatedAt === null));
  check(v.active || p === null);
}
export function readTracking(v: any, rideId: string): Tracking {
  envelope(v);
  check(v.rideId === rideId && typeof v.canShare === 'boolean' && typeof v.isDriver === 'boolean');
  check(!v.canShare || v.isDriver);
  if (v.share !== null) { share(v.share); check(v.share.rideId === rideId); }
  return v;
}
export function readTrackingResult(v: any, expected: { rideId?: string; shareId?: string; stopped?: boolean }): TrackingResult {
  envelope(v); check(typeof v.replayed === 'boolean'); share(v.share);
  if (expected.rideId) check(v.share.rideId === expected.rideId);
  if (expected.shareId) check(v.share.id === expected.shareId);
  if (expected.stopped) check(!v.share.active);
  return v;
}
