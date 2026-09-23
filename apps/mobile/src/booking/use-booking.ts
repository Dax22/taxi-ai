import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useSession } from '../session/provider';
import { BookingController } from './controller';
import { currentPickupPlace } from './location';

export function useBooking() {
  const { client, user } = useSession();
  const controller = useMemo(() => new BookingController(client, randomUUID, undefined, currentPickupPlace), [client, user?.id]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useFocusEffect(useCallback(() => {
    if (AppState.currentState === 'active') controller.activate();
    const listener = AppState.addEventListener('change', (next) => next === 'active' ? controller.activate() : controller.pause());
    const poll = setInterval(() => { void controller.refresh(); }, 10_000);
    const tick = setInterval(() => controller.tick(), 1000);
    return () => { listener.remove(); clearInterval(poll); clearInterval(tick); controller.pause(); };
  }, [controller]));
  // Focus cleanup pauses all reads/timers; in-flight writes may settle privately after unmount.
  // No persistent store survives this screen. Avoid destroying a memo during React effect replay.
  return { state, controller };
}
