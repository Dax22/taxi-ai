import { useCallback, useEffect, useMemo } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSession } from '../session/provider';

interface Controller { activate(): void; pause(): void; dispose(): void; tick(): void; refresh(): Promise<void> }
export function useParcelFocus(controller: Controller) {
  const { client, user, blocked, mode } = useSession();
  const lifetime = useMemo(() => ({ active: false }), [controller]);
  useEffect(() => { lifetime.active = true; return () => {
    lifetime.active = false; queueMicrotask(() => { if (!lifetime.active) controller.dispose(); });
  }; }, [controller, lifetime]);
  useFocusEffect(useCallback(() => {
    let active = true, generation = 0;
    const owner = user?.id;
    if (!owner || blocked || mode !== 'customer') { controller.pause(); return; }
    if (AppState.currentState === 'active') controller.activate();
    const foreground = AppState.addEventListener('change', state => {
      const epoch = ++generation;
      controller.pause();
      if (state === 'active') void client.session().then(() => {
        if (active && generation === epoch && AppState.currentState === 'active' && client.account()?.id === owner) controller.activate();
      }).catch(() => {});
    });
    const account = client.subscribe(next => { if (next?.id !== owner) { generation++; controller.pause(); } });
    const changes = client.subscribeChanges(() => controller.refresh());
    const tick = setInterval(() => controller.tick(), 1000), poll = setInterval(() => void controller.refresh(), 5000);
    return () => { active = false; generation++; foreground.remove(); account(); changes(); clearInterval(tick); clearInterval(poll); controller.pause(); };
  }, [controller, client, user?.id, blocked, mode]));
}
