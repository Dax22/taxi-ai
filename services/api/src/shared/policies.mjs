import { check } from './errors.mjs';

export function requireRole(user, role) {
  check(user?.role === role, 'FORBIDDEN', `A ${role} account is required.`);
  if (role === 'driver') {
    check(user.driver?.status === 'approved', 'DRIVER_NOT_APPROVED', 'Administrator approval is required first.');
  }
}

export function requireEligibleDriver(user) {
  requireRole(user, 'driver');
  check(user.driver.eligibility?.eligible === true, 'DRIVER_NOT_ELIGIBLE', 'A reviewed application and current documents are required before accepting or starting a ride.');
}
