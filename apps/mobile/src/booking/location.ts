import * as Location from 'expo-location';
import { assertCurrentPickup } from '../../../../packages/shared/src/locations.mjs';
import type { Place } from '../../../../packages/shared/src/mobile-booking.mjs';

export async function currentPickupPlace(): Promise<Place> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Allow location access in your phone settings, then use your current location again.');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('A fresh pickup location is unavailable. Try again in an open area.')), 10_000);
      }),
    ]);
    const place = { name: 'Current location', lat: fix.coords.latitude, lng: fix.coords.longitude };
    assertCurrentPickup(place, fix.coords.accuracy);
    return place;
  } finally { clearTimeout(timeout); }
}
