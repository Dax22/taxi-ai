import { createStaffFactor } from './staff-factor.mjs';

export function createStaffMfaConfig(env = process.env) {
  const setting = env.TAXI_AI_STAFF_MFA_REQUIRED ?? 'false';
  if (!['true', 'false'].includes(setting)) throw new Error('TAXI_AI_STAFF_MFA_REQUIRED must be true or false.');
  const required = setting === 'true';
  return Object.freeze({ required, factor: createStaffFactor({ key: env.TAXI_AI_STAFF_MFA_KEY ?? '', required }) });
}
