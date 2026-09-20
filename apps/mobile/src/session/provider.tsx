import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { MobileClient, ApiError } from '../api/client.ts';
import { secureVault } from './secure-vault';
import type { Account, Mode } from '../../../../packages/shared/src/mobile-contracts.mjs';

interface SessionContextValue {
  client: MobileClient; user: Account | null; ready: boolean; blocked: boolean; startupError: string;
  notice: string; mode: Mode; setMode(mode: Mode): void; restore(): Promise<void>; logout(): Promise<void>;
}
const SessionContext = createContext<SessionContextValue | null>(null);
export function SessionProvider({ children }: PropsWithChildren) {
  const client = useMemo(() => new MobileClient({ origin: process.env.EXPO_PUBLIC_API_ORIGIN ?? (__DEV__ ? 'http://127.0.0.1:3000' : ''), vault: secureVault, development: __DEV__ }), []);
  const [user, setUser] = useState<Account | null>(null), [mode, setMode] = useState<Mode>('customer');
  const [ready, setReady] = useState(false), [blocked, setBlocked] = useState(false);
  const [startupError, setStartupError] = useState(''), [notice, setNotice] = useState('');
  const restore = useCallback(async () => {
    setReady(false); setStartupError('');
    try { await client.restore(); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') setNotice('Your session ended. Please sign in again.');
      else setStartupError(error instanceof Error ? error.message : 'Could not restore this device.');
    } finally { setReady(true); }
  }, [client]);
  useEffect(() => client.subscribe((next) => { setUser(next); if (!next?.driver) setMode('customer'); }), [client]);
  useEffect(() => { void restore(); }, [restore]);
  useEffect(() => {
    let generation = 0;
    const subscription = AppState.addEventListener('change', (state) => {
      const epoch = ++generation;
      if (state !== 'active') { setBlocked(true); return; }
      if (!client.account()) { setBlocked(false); return; }
      setBlocked(true);
      void client.session().then(() => { if (epoch === generation) setStartupError(''); })
        .catch((error: unknown) => { if (epoch === generation && client.account()) setStartupError(error instanceof Error ? error.message : 'Connection interrupted.'); })
        .finally(() => { if (epoch === generation) setBlocked(false); });
    });
    return () => { generation++; subscription.remove(); };
  }, [client]);
  const logout = useCallback(async () => {
    setMode('customer'); setStartupError(''); setNotice('');
    const warning = await client.logout(); if (warning) setNotice(warning);
  }, [client]);
  return <SessionContext.Provider value={{ client, user, ready, blocked, startupError, notice, mode,
    setMode: (next) => setMode(next === 'work' && !user?.driver ? 'customer' : next), restore, logout }}>{children}</SessionContext.Provider>;
}
export function useSession() { const value = useContext(SessionContext); if (!value) throw new Error('Session provider is missing.'); return value; }
