import { insideNigeria } from '../../../../packages/shared/src/locations.mjs';
import { OUTSIDE_NIGERIA_FOOD_MESSAGE } from '../../../../packages/shared/src/eats-delivery.mjs';

export type DeliveryPosition = { lat: number; lng: number; accuracy: number; capturedAt: number };
export type DeliveryLocationFix = {
  coords: { latitude: number; longitude: number; accuracy: number | null };
  timestamp: number;
};

type DeliveryLocationDependencies = {
  requestPermission: () => Promise<{ granted: boolean }>;
  getCurrentFix: () => Promise<DeliveryLocationFix>;
  now?: () => number;
  scheduleTimeout?: (callback: () => void, delayMs: number) => unknown;
  cancelTimeout?: (handle: unknown) => void;
};

const UNAVAILABLE = 'Your delivery location is unavailable. Check your phone location settings and try again, or enter the delivery address manually.';
const FRESH_FIX_REQUIRED = 'A fresh delivery location is unavailable. Try again in an open area, or enter the delivery address manually.';

function deliveryPosition(fix: DeliveryLocationFix, now: number): DeliveryPosition {
  const lat = fix?.coords?.latitude, lng = fix?.coords?.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    throw new Error(UNAVAILABLE);
  const capturedAt = fix.timestamp;
  // Small device-clock skew is tolerated, but cached or implausibly future fixes are not.
  if (!Number.isFinite(now) || !Number.isFinite(capturedAt) || capturedAt <= 0
    || now - capturedAt > 30_000 || capturedAt - now > 5_000)
    throw new Error(FRESH_FIX_REQUIRED);
  if (!insideNigeria({ lat, lng })) throw new Error(OUTSIDE_NIGERIA_FOOD_MESSAGE);
  const accuracy = fix.coords.accuracy;
  if (accuracy === null || !Number.isFinite(accuracy) || accuracy <= 0 || accuracy > 200)
    throw new Error('Your delivery location is not accurate enough yet. Try again in an open area, or enter the delivery address manually.');
  return { lat, lng, accuracy, capturedAt };
}

/** Construction has no location side effects. Call only after the customer requests GPS. */
export function createCurrentDeliveryPosition({ requestPermission, getCurrentFix, now = Date.now,
  scheduleTimeout = (callback, delayMs) => setTimeout(callback, delayMs),
  cancelTimeout = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: DeliveryLocationDependencies): (signal?: AbortSignal) => Promise<DeliveryPosition> {
  return async (signal) => {
    const cancelled = () => Object.assign(new Error('Delivery location request was cancelled.'), { name: 'AbortError' });
    const assertActive = () => { if (signal?.aborted) throw cancelled(); };
    assertActive();
    let abort: (() => void) | undefined;
    const cancellation = new Promise<never>((_, reject) => {
      abort = () => reject(cancelled());
      signal?.addEventListener('abort', abort, { once: true });
    });
    let timer: unknown;
    try {
      const permissionRequest = Promise.resolve().then(() => {
        assertActive();
        return requestPermission();
      }).catch(() => { assertActive(); throw new Error(UNAVAILABLE); });
      const permission = await Promise.race([permissionRequest, cancellation]);
      assertActive();
      if (!permission.granted)
        throw new Error('Allow location access in your phone settings to use your delivery location, or enter the delivery address manually.');
      // Bound acquisition after permission; never substitute a last-known location.
      const timeout = new Promise<never>((_, reject) => {
        timer = scheduleTimeout(() => reject(new Error(FRESH_FIX_REQUIRED)), 10_000);
      });
      const currentFix = Promise.resolve().then(() => {
        assertActive();
        return getCurrentFix();
      }).catch(() => { assertActive(); throw new Error(UNAVAILABLE); });
      // Expo cannot cancel an in-flight native fix; cancellation detaches this request's result.
      const fix = await Promise.race([currentFix, timeout, cancellation]);
      assertActive();
      return deliveryPosition(fix, now());
    } finally {
      cancelTimeout(timer);
      if (abort) signal?.removeEventListener('abort', abort);
    }
  };
}
