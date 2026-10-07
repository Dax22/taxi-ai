import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { MobileClient, ApiError } from '../api/client.ts';
import { secureVault, savedAppRole, saveAppRole } from './secure-vault';
import { stopAllBackgroundTracking } from '../tracking/background-task';
import { restoreSession } from './restore';
import { mobileHeartbeat } from '../operations/heartbeat';
import type { AppRole } from './secure-vault';
import type { Account, Mode } from '../../../../packages/shared/src/mobile-contracts.mjs';

type StartingExperience = 'customer' | 'driver' | 'eats_seller';
interface SessionContextValue {
  client: MobileClient; user: Account | null; ready: boolean; blocked: boolean; startupError: string;
  notice: string; role: AppRole | null; setupLoading: boolean; mode: Mode; startingExperience: StartingExperience | null;
  consumeStartingExperience(): void; chooseRole(role: AppRole): Promise<void>; restore(): Promise<void>; logout(): Promise<void>;
}
const SessionContext = createContext<SessionContextValue | null>(null);
export function SessionProvider({ children }: PropsWithChildren) {
  const client = useMemo(() => new MobileClient({ origin: process.env.EXPO_PUBLIC_API_ORIGIN ?? (__DEV__ ? 'http://127.0.0.1:3000' : ''), vault: secureVault, development: __DEV__ }), []);
  const [user, setUser] = useState<Account | null>(null), [role, setRole] = useState<AppRole | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [startingExperience, setStartingExperience] = useState<StartingExperience | null>(null);
  const accountId = useRef<string | null>(null);
  const [ready, setReady] = useState(false), [blocked, setBlocked] = useState(false);
  const [startupError, setStartupError] = useState(''), [notice, setNotice] = useState('');
  const restore = useCallback(async () => {
    setReady(false); setStartupError('');
    try { await restoreSession(client, stopAllBackgroundTracking); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') setNotice('Your session ended. Please sign in again.');
      else setStartupError(error instanceof Error ? error.message : 'Could not restore this device.');
    } finally { setReady(true); }
  }, [client]);
  useEffect(() => {
    let generation = 0;
    return client.subscribe((next) => {
      setUser(next);
      if (accountId.current === (next?.id ?? null)) return;
      // Kill the publishing generation immediately on an account change, before vault or network cleanup finishes.
      void stopAllBackgroundTracking().catch(() => {});
      accountId.current = next?.id ?? null;
      const epoch = ++generation;
      setRole(null); setStartingExperience(null);
      if (!next) { setSetupLoading(false); return; }
      setSetupLoading(true);
      void savedAppRole(next.id).then(async (saved) => {
        if (epoch !== generation) return;
        const startingRole: AppRole | null = next.startingExperience === 'driver' ? 'driver'
          : next.startingExperience === 'customer' || next.startingExperience === 'eats_seller' ? 'customer' : null;
        if (!saved && startingRole) {
          await saveAppRole(next.id, startingRole);
          if (epoch === generation) { setRole(startingRole); setStartingExperience(next.startingExperience ?? null); }
        } else if (epoch === generation) setRole(saved);
      })
        .catch(() => { if (epoch === generation) setNotice('Could not read this phone’s account setup. Choose your app experience again.'); })
        .finally(() => { if (epoch === generation) setSetupLoading(false); });
    });
  }, [client]);
  useEffect(() => { void restore(); }, [restore]);
  useEffect(() => {
    let generation = 0;
    const subscription = AppState.addEventListener('change', (state) => {
      const epoch = ++generation;
      if (state !== 'active') { client.pauseUpdates(); setBlocked(true); return; }
      if (!client.account()) { setBlocked(false); return; }
      setBlocked(true);
      void client.session().then(() => { if (epoch === generation) setStartupError(''); })
        .catch((error: unknown) => { if (epoch === generation && client.account()) setStartupError(error instanceof Error ? error.message : 'Connection interrupted.'); })
        .finally(() => { if (epoch === generation) setBlocked(false); });
    });
    return () => { generation++; subscription.remove(); };
  }, [client]);
  useEffect(() => {
    if (user && ready && !blocked && AppState.currentState === 'active') client.resumeUpdates();
    else client.pauseUpdates();
    return () => client.pauseUpdates();
  }, [client, user?.id, ready, blocked]);
  useEffect(() => {
    if (!user || !ready || blocked || AppState.currentState !== 'active') return;
    let active=true; const send=()=>{ if(active&&client.account()?.id===user.id) void mobileHeartbeat(client).catch(()=>{}); };
    send(); const timer=setInterval(send,5*60_000); return()=>{active=false;clearInterval(timer);};
  }, [client, user?.id, ready, blocked]);
  const logout = useCallback(async () => {
    setStartupError(''); setNotice('');
    await stopAllBackgroundTracking().catch(() => {});
    const warning = await client.logout(); if (warning) setNotice(warning);
  }, [client]);
  const chooseRole = async (next: AppRole) => {
    if (!user || role || client.account()?.id !== user.id) return;
    await saveAppRole(user.id, next);
    if (client.account()?.id === user.id) { setRole(next); setNotice(''); }
  };
  return <SessionContext.Provider value={{ client, user, ready, blocked, startupError, notice, role, setupLoading, startingExperience,
    consumeStartingExperience: () => setStartingExperience(null),
    mode: role === 'driver' ? 'work' : 'customer', chooseRole, restore, logout }}>{children}</SessionContext.Provider>;
}
export function useSession() { const value = useContext(SessionContext); if (!value) throw new Error('Session provider is missing.'); return value; }
