import { check } from './errors.mjs';

/** The account service supplies effective server-owned scopes on every fresh profile read. */
export function isRestricted(user, scope) {
  const scopes=user?.restrictions?.scopes??[];
  return scopes.includes('account') || scopes.includes(scope);
}
export function requireUnrestricted(user, scope) {
  check(!isRestricted(user,scope),'ACCOUNT_RESTRICTED','This account is temporarily restricted from new '+(scope==='customer'?'bookings and orders':scope==='vendor'?'vendor orders':'driving and delivery work')+'. Open Account notices for the reason and appeal options. Existing transaction support remains available.');
}
export function requireNewDriverWork(user) {
  requireUnrestricted(user,'driver');requireUnrestricted(user,'vehicle');
}
