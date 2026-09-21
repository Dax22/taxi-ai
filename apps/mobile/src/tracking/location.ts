import * as Location from 'expo-location';
import type { Position } from './contracts';

/** Only an explicit trip-sharing action may request foreground permission. */
export async function tripPosition(ask: boolean, isCurrent: () => boolean = () => true): Promise<Position> {
  const permission = ask ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
  if (!isCurrent()) throw new Error('Location sharing was stopped. Choose Share my location to start again.');
  if (!permission.granted) throw new Error('Allow location access in your phone settings, then choose Share my location again.');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('A fresh location is unavailable. Try again in an open area.')), 10_000); }),
    ]);
    if (!isCurrent()) throw new Error('Location sharing was stopped.');
    if (!Number.isFinite(fix.coords.accuracy) || fix.coords.accuracy === null || fix.coords.accuracy <= 0 || fix.coords.accuracy > 200)
      throw new Error('Location is not accurate enough yet. Try again in an open area.');
    return { lat: fix.coords.latitude, lng: fix.coords.longitude, accuracy: fix.coords.accuracy, capturedAt: Math.round(fix.timestamp) };
  } finally { clearTimeout(timeout); }
}
