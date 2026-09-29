import type { FamilyCheckIn } from '../../../../packages/shared/src/family.mjs';
/** A new request is still pending even if the trip has an older response. */
export function familyCheckInState(checkIn: FamilyCheckIn | null) {
  if (!checkIn) return null;
  if (checkIn.requestedAt !== null && (checkIn.respondedAt === null || checkIn.requestedAt > checkIn.respondedAt)) return 'pending';
  return checkIn.response;
}
