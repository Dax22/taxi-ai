import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { backgroundLocationVault } from '../session/secure-vault';
import { createBackgroundTrackingApi } from '../api/client';
import type { MobileClient } from '../api/client';
import { BackgroundLocationManager } from './background-core';
import type { BackgroundConnection, ControllerBackground, TrackingKind } from './background-contracts';

export const BACKGROUND_LOCATION_TASK = 'taxi-ai.active-work-location.v1';
const origin = process.env.EXPO_PUBLIC_API_ORIGIN ?? (__DEV__ ? 'http://127.0.0.1:3000' : '');
const transport = (connection?: BackgroundConnection) => createBackgroundTrackingApi({ ...connection, origin: connection?.origin ?? origin, development: __DEV__ });
async function stopNative() {
  if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
}
const manager = new BackgroundLocationManager({
  vault: backgroundLocationVault,
  native: {
    permissions: async () => (await Location.getForegroundPermissionsAsync()).granted && (await Location.getBackgroundPermissionsAsync()).granted,
    stop: stopNative,
    start: async () => {
      if (AppState.currentState !== 'active') throw new Error('Return to Taxi Ai to start work location sharing.');
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 0,
        deferredUpdatesInterval: 10_000, deferredUpdatesDistance: 0,
        pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true,
        activityType: Location.ActivityType.AutomotiveNavigation,
        foregroundService: { notificationTitle: 'Taxi Ai work location is sharing',
          notificationBody: 'Your active job can be followed. Open Taxi Ai to stop sharing.', killServiceOnDestroy: true },
      });
    },
  },
  api: {
    position: (token, sequence, position, connection) => transport(connection).position(token, sequence, position),
    stop: (token, connection) => transport(connection).stop(token),
  },
});

// Expo loads this module for headless delivery without mounting React. Registration never requests GPS.
TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) { await manager.stop(); return; }
  try {
    await manager.handle((data?.locations ?? []).map(fix => ({ lat: fix.coords.latitude, lng: fix.coords.longitude,
      accuracy: fix.coords.accuracy ?? 0, capturedAt: Math.round(fix.timestamp) })));
  } catch { await manager.stop().catch(() => {}); }
});

/** Invoke before logout/session clearing; consent is invalidated before the returned promise settles. */
export function stopAllBackgroundTracking(): Promise<void> { return manager.stop(); }

export function controllerBackground(client: MobileClient, kind: TrackingKind, jobId: string, clientId: string): ControllerBackground {
  const binding = { kind, jobId, clientId };
  return {
    prepare: async (isCurrent) => {
      if (!await TaskManager.isAvailableAsync()) throw new Error('Background work tracking needs an installed Taxi Ai development or release build.');
      if (!isCurrent()) return;
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (!isCurrent()) return;
      if (!foreground.granted) throw new Error('Location sharing is required during active work. Allow location access to start; you can stop at any time.');
      const background = await Location.requestBackgroundPermissionsAsync();
      if (!isCurrent()) return;
      if (!background.granted) throw new Error('Allow location all the time in phone settings to share during active work, including a locked screen. You can stop at any time.');
    },
    start: async (share, _serverNow, isCurrent) => {
      if (!isCurrent()) return;
      const result = await client.enableBackgroundTracking(kind, jobId, share.id, clientId, randomUUID());
      const connection = client.backgroundConnection();
      if (result.background.kind !== kind || result.background.jobId !== jobId || result.background.shareId !== share.id || result.background.clientId !== clientId) {
        await transport(connection).stop(result.background.token).catch(() => {});
        throw new Error('Background authorization belongs to another job.');
      }
      await manager.begin({ ...result, connection }, isCurrent);
    },
    stop: () => manager.stop(binding),
    recovering: async () => Boolean((await manager.current())?.failures),
    active: async () => {
      const lease = await manager.current();
      return Boolean(lease && lease.kind === kind && lease.jobId === jobId && lease.clientId === clientId);
    },
  };
}
