import * as SecureStore from 'expo-secure-store';
import type { Vault } from '../api/client.ts';
const KEY = 'taxi-ai.device.v1';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export const secureVault: Vault = {
  read: () => SecureStore.getItemAsync(KEY, options),
  write: (value) => SecureStore.setItemAsync(KEY, value, options),
  clear: () => SecureStore.deleteItemAsync(KEY, options),
};
