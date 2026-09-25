import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useSession } from '../session/provider';
import { TripLocationController } from './controller';
import { tripPosition } from './location';
import type { MobileClient } from '../api/client';

class Registry {
  private entries = new Map<string, { controller: TripLocationController; observers: number }>();
  private listeners = new Set<() => void>();
  private controllers: TripLocationController[] = [];
  private active = false;
  private client: MobileClient;
  constructor(client: MobileClient) { this.client = client; }
  snapshot = () => this.controllers;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  get(id: string) {
    let entry = this.entries.get(id);
    if (!entry) { entry = { controller: new TripLocationController(this.client, id, randomUUID, tripPosition), observers: 0 }; this.entries.set(id, entry); }
    return entry.controller;
  }
  observe(id: string) {
    this.get(id); const entry = this.entries.get(id)!; entry.observers++;
    this.controllers = [...this.entries.values()].map(e => e.controller);
    for (const fn of this.listeners) fn();
    if (this.active) entry.controller.activate();
    return () => { entry.observers = Math.max(0, entry.observers - 1); };
  }
  private needed(entry: { controller: TripLocationController; observers: number }) {
    const state = entry.controller.snapshot();
    return entry.observers > 0 || state.sharing || state.uncertain || state.busy;
  }
  activate() { this.active = true; for (const entry of this.entries.values()) if (this.needed(entry)) entry.controller.activate(); }
  pause() { this.active = false; for (const entry of this.entries.values()) entry.controller.pause(); }
  tick() { if (this.active) for (const entry of this.entries.values()) entry.controller.tick(); }
  poll() {
    if (!this.active) return;
    for (const entry of this.entries.values()) {
      if (this.needed(entry)) void entry.controller.heartbeat();
      else entry.controller.pause();
    }
  }
  refresh() { if (this.active) for (const entry of this.entries.values()) if (this.needed(entry)) void entry.controller.refresh(); }
  dispose() { this.active = false; for (const entry of this.entries.values()) entry.controller.dispose(); this.entries.clear(); this.listeners.clear(); }
}
const Context = createContext<Registry | null>(null);
export function TripLocationProvider({ children }: PropsWithChildren) {
  const { client, blocked, user } = useSession();
  const registry = useMemo(() => new Registry(client), [client]);
  useEffect(() => {
    if (blocked || !user) { registry.pause(); return; }
    if (AppState.currentState === 'active') registry.activate();
    const state = AppState.addEventListener('change', next => { if (next !== 'active') registry.pause(); });
    const changed = client.subscribeChanges(() => registry.refresh());
    const poll = setInterval(() => registry.poll(), 10_000), tick = setInterval(() => registry.tick(), 1000);
    return () => { registry.pause(); state.remove(); changed(); clearInterval(poll); clearInterval(tick); };
  }, [registry, blocked, user?.id]);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; queueMicrotask(() => { if (!alive.current) registry.dispose(); }); }; }, [registry]);
  return <Context.Provider value={registry}>{children}</Context.Provider>;
}
function useRegistry() { const registry = useContext(Context); if (!registry) throw new Error('Trip location controls are unavailable.'); return registry; }
export function useTripLocation(id: string) {
  const registry = useRegistry(), controller = registry.get(id);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useFocusEffect(useCallback(() => registry.observe(id), [registry, id]));
  return { controller, state };
}
export function useTripLocationControllers() { const registry = useRegistry(); return useSyncExternalStore(registry.subscribe, registry.snapshot); }
