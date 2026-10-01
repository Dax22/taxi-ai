import * as Location from 'expo-location';
import { createCurrentDeliveryPosition } from './delivery-location-core.ts';

/** Foreground, one-shot acquisition; aborting discards late results and prevents acquisition after a permission prompt. */
export const currentDeliveryPosition = createCurrentDeliveryPosition({
  requestPermission: () => Location.requestForegroundPermissionsAsync(),
  getCurrentFix: () => Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
});
