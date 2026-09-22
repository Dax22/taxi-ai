import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { createEatsController } from '../../../../packages/shared/src/eats-controller.mjs';
import type { EatsController, EatsScreen } from '../../../../packages/shared/src/eats-controller.mjs';
import { useSession } from '../session/provider';
const EatsContext = createContext<EatsController | null>(null);
export function EatsProvider({ children }: PropsWithChildren) {
  const { client, user } = useSession();
  const controller = useMemo(() => {
    let time = { at: Date.now(), seen: performance.now() };
    const request = async (path: string, data?: unknown, key?: string) => {
      const result = await client.eats(path, data, key);
      if (typeof result.serverNow === 'number') time = { at: result.serverNow, seen: performance.now() };
      return result;
    };
    return createEatsController({ api: { request, command: request }, makeKey: randomUUID, now: () => time.at + performance.now() - time.seen });
  }, [client]);
  useEffect(() => { controller.context(user); }, [controller, user]);
  useEffect(() => () => controller.reset(), [controller]);
  return <EatsContext.Provider value={controller}>{children}</EatsContext.Provider>;
}
export function useEatsScreen(screen: EatsScreen, id: string | null = null) {
  const controller = useContext(EatsContext); if (!controller) throw new Error('Eats provider is missing.');
  const { blocked, user } = useSession();
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useFocusEffect(useCallback(() => {
    if (blocked) return;
    controller.context(user); void controller.navigate(screen, id);
    const timer = setInterval(() => {
      controller.tick(); const current = controller.snapshot();
      if (!current.busy && !current.uncertain && (current.screen !== screen || (screen === 'order' && current.orderId !== id))) void controller.navigate(screen, id);
      else void controller.refresh({ quiet: true });
    }, 5000);
    return () => clearInterval(timer);
  }, [controller, screen, id, blocked, user?.id]));
  return { state, controller, locked: state.busy || state.uncertain || state.stale || blocked };
}
