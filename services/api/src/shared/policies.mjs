import { check } from './errors.mjs';

/** Capability membership is independent of a driver's approval/eligibility. */
export function hasCapability(user, capability) {
  if (capability === 'admin') return user?.role === 'admin';
  return user?.role !== 'admin' && user?.capabilities?.includes(capability) === true;
}

export function requireRole(user, role) {
  check(hasCapability(user, role), 'FORBIDDEN', `The ${role} capability is required.`);
  if (role === 'driver') {
    check(user.driver?.status === 'approved', 'DRIVER_NOT_APPROVED', 'Administrator approval is required first.');
  }
}

export function requireEligibleDriver(user) {
  requireRole(user, 'driver');
  check(user.driver.eligibility?.eligible === true, 'DRIVER_NOT_ELIGIBLE', 'A reviewed application and current documents are required before accepting or starting a ride.');
}
