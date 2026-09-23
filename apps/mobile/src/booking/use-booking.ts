import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useSession } from '../session/provider';
import { BookingController } from './controller';
import { currentPickupPlace } from './location';

export function useBooking() {
  const { client, user } = useSession();
  const controller = useMemo(() => new BookingController(client, randomUUID, undefined, currentPickupPlace), [client, user?.id]);
  const lifetime = useMemo(() => ({ active: false }), [controller]);
  useEffect(() => {
    lifetime.active = true;
    return () => { lifetime.active = false; queueMicrotask(() => { if (!lifetime.active) controller.dispose(); }); };
  }, [controller, lifetime]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useFocusEffect(useCallback(() => {
    if (AppState.currentState === 'active') controller.activate();
    const listener = AppState.addEventListener('change', (next) => next === 'active' ? controller.activate() : controller.pause());
    const poll = setInterval(() => { void controller.refresh(); }, 10_000);
    const tick = setInterval(() => controller.tick(), 1000);
    return () => { listener.remove(); clearInterval(poll); clearInterval(tick); controller.pause(); };
  }, [controller]));
  // Focus changes pause reads; unmount/account changes erase drafts and ignore late writes.
  return { state, controller };
}
