import * as SecureStore from 'expo-secure-store';
import type { Vault } from '../api/client.ts';
const KEY = 'taxi-ai.device.v1';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export type AppRole = 'customer' | 'driver';
const roleKey = (accountId: string) => `taxi-ai.app-role.v1.${accountId}`;
export async function savedAppRole(accountId: string): Promise<AppRole | null> {
  const value = await SecureStore.getItemAsync(roleKey(accountId), options);
  return value === 'customer' || value === 'driver' ? value : null;
}
export async function saveAppRole(accountId: string, role: AppRole): Promise<void> {
  await SecureStore.setItemAsync(roleKey(accountId), role, options);
}
export const secureVault: Vault = {
  read: () => SecureStore.getItemAsync(KEY, options),
  write: (value) => SecureStore.setItemAsync(KEY, value, options),
  clear: () => SecureStore.deleteItemAsync(KEY, options),
};
