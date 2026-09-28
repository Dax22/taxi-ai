import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../session/provider';
import { FamilyController } from './controller';

export function useFamily() {
  const { client, user, blocked } = useSession();
  const controller = useMemo(() => new FamilyController(client, randomUUID), [client, user?.id]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useFocusEffect(useCallback(() => {
    if (!user || blocked) return;
    if (AppState.currentState === 'active') controller.activate();
    const listener = AppState.addEventListener('change', next => next === 'active' ? controller.activate() : controller.pause());
    const changed = client.subscribeChanges(() => controller.refresh());
    const tick = setInterval(() => controller.tick(), 1000);
    return () => { listener.remove(); changed(); clearInterval(tick); controller.pause(); };
  }, [controller, client, user?.id, blocked]));
  const mounted = useRef<FamilyController | null>(null);
  useEffect(() => {
    mounted.current = controller;
    return () => { mounted.current = null; queueMicrotask(() => { if (mounted.current !== controller) controller.dispose(); }); };
  }, [controller]);
  return { controller, state };
}
