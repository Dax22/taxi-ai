import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useSession } from '../session/provider';
import { TripLocationController } from './controller';
import { tripPosition } from './location';
import type { MobileClient } from '../api/client';
import type { TrackingKind } from './background-contracts';
import { controllerBackground } from './background-task';

class Registry {
  private entries = new Map<string, { controller: TripLocationController; observers: number }>();
  private listeners = new Set<() => void>();
  private controllers: TripLocationController[] = [];
  private active = false;
  private client: MobileClient;
  constructor(client: MobileClient) { this.client = client; }
  snapshot = () => this.controllers;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  get(id: string, kind: TrackingKind = 'ride') {
    const identity = `${kind}:${id}`;
    let entry = this.entries.get(identity);
    if (!entry) {
      const clientId = randomUUID();
      const api = kind === 'ride' ? this.client : {
        tracking: this.client.foodTracking.bind(this.client), startTracking: this.client.startFoodTracking.bind(this.client),
        stopTracking: this.client.stopFoodTracking.bind(this.client), trackingPosition: this.client.foodTrackingPosition.bind(this.client),
      };
      entry = { controller: new TripLocationController(api, id, randomUUID, tripPosition, undefined, undefined,
        { kind, clientId, background: controllerBackground(this.client, kind, id, clientId) }), observers: 0 };
      this.entries.set(identity, entry);
    }
    return entry.controller;
  }
  observe(id: string, kind: TrackingKind = 'ride') {
    this.get(id, kind); const entry = this.entries.get(`${kind}:${id}`)!; entry.observers++;
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
  suspend() { this.active = false; for (const entry of this.entries.values()) entry.controller.suspend(); }
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
  const registry = useMemo(() => new Registry(client), [client, user?.id]);
  useEffect(() => {
    if (!user) { registry.pause(); return; }
    if (blocked) { registry.suspend(); return; }
    if (AppState.currentState === 'active') registry.activate();
    const state = AppState.addEventListener('change', next => { if (next !== 'active') registry.suspend(); });
    const changed = client.subscribeChanges(() => registry.refresh());
    const poll = setInterval(() => registry.poll(), 10_000), tick = setInterval(() => registry.tick(), 1000);
    return () => { registry.suspend(); state.remove(); changed(); clearInterval(poll); clearInterval(tick); };
  }, [registry, blocked, user?.id]);
  const alive = useRef(false);
  const latestRegistry = useRef(registry);
  useEffect(() => {
    alive.current = true; latestRegistry.current = registry;
    return () => { alive.current = false; queueMicrotask(() => { if (!alive.current || latestRegistry.current !== registry) registry.dispose(); }); };
  }, [registry]);
  return <Context.Provider value={registry}>{children}</Context.Provider>;
}
function useRegistry() { const registry = useContext(Context); if (!registry) throw new Error('Trip location controls are unavailable.'); return registry; }
export function useTripLocation(id: string, kind: TrackingKind = 'ride') {
  const registry = useRegistry(), controller = registry.get(id, kind);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useFocusEffect(useCallback(() => registry.observe(id, kind), [registry, id, kind]));
  return { controller, state };
}
export function useTripLocationControllers() { const registry = useRegistry(); return useSyncExternalStore(registry.subscribe, registry.snapshot); }
