/** Presentation only. APIs authorize capabilities and the actor on each resource. */
export const ACCOUNT_MODES = Object.freeze(['customer', 'work']);

export function canUseMode(account, mode) {
  return account?.role !== 'admin' && ACCOUNT_MODES.includes(mode)
    && account?.capabilities?.includes(mode === 'work' ? 'driver' : 'customer') === true;
}

export function accountInMode(account, mode) {
  if (!account || account.role === 'admin') return account;
  return { ...account, role: mode === 'work' ? 'driver' : 'customer' };
}

export function modeForRide(account, ride) {
  return ride?.driver?.id === account?.id ? 'work' : 'customer';
}
