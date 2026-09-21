import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../session/provider';
import { SafetyController } from './controller';

const Context = createContext<((id: string | null) => SafetyController) | null>(null);
/** Mounted with the account's key; pending commands survive navigation, not account changes. */
export function SafetyProvider({ children }: PropsWithChildren) {
  const { client, user } = useSession();
  const controllers = useMemo(() => new Map<string, SafetyController>(), [client, user?.id]);
  const owner = user?.id;
  useEffect(() => client.subscribe((next) => {
    if (next?.id !== owner) { for (const controller of controllers.values()) controller.dispose(); controllers.clear(); }
  }), [client, owner, controllers]);
  // Preserve controllers during Strict Mode effect replay, but clear on real unmount.
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; queueMicrotask(() => {
    if (!alive.current) { for (const controller of controllers.values()) controller.dispose(); controllers.clear(); }
  }); }; }, [controllers]);
  const get = useCallback((id: string | null) => {
    const key = id ?? 'contacts'; let controller = controllers.get(key);
    if (!controller) { controller = new SafetyController(client, id, randomUUID); controllers.set(key, controller); }
    return controller;
  }, [client, controllers]);
  return <Context.Provider value={get}>{children}</Context.Provider>;
}
export function useSafety(id: string | null) {
  const get = useContext(Context); if (!get) throw new Error('Safety context is unavailable.');
  const controller = get(id), { blocked } = useSession();
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useFocusEffect(useCallback(() => {
    if (blocked) { controller.pause(); return; }
    if (AppState.currentState === 'active') controller.activate();
    const listener = AppState.addEventListener('change', (next) => next === 'active' ? controller.activate() : controller.pause());
    const poll = setInterval(() => void controller.refresh(), 10_000), tick = setInterval(() => controller.tick(), 1000);
    return () => { listener.remove(); clearInterval(poll); clearInterval(tick); controller.pause(); };
  }, [controller, blocked]));
  return { controller, state };
}
