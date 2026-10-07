import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

export interface DeviceMapPosition { lat: number; lng: number; accuracy: number | null; capturedAt: number }

function value(fix: Location.LocationObject): DeviceMapPosition {
  return { lat: fix.coords.latitude, lng: fix.coords.longitude,
    accuracy: Number.isFinite(fix.coords.accuracy) ? fix.coords.accuracy : null, capturedAt: fix.timestamp };
}

/** Map-only phone position. Passive reads never prompt; explicit locate() may request foreground permission. */
export function useDeviceMapPosition() {
  const [position, setPosition] = useState<DeviceMapPosition | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; void (async () => {
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) return;
      const last = await Location.getLastKnownPositionAsync({ maxAge: 120_000, requiredAccuracy: 1000 });
      if (alive.current && last) setPosition(value(last));
    } catch { /* A home map never blocks the rest of the app. */ }
  })(); return () => { alive.current = false; }; }, []);
  const locate = useCallback(async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Allow location access in your phone settings to centre the map on you.');
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      if (alive.current) setPosition(value(fix));
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Current location is unavailable.'); }
    finally { if (alive.current) setBusy(false); }
  }, [busy]);
  return { position, busy, error, locate } as const;
}
