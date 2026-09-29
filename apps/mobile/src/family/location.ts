import type { FamilyVehicleLocation } from '../../../../packages/shared/src/family.mjs';

/** Time labels are independent of receipt time; an old fix can never become live after a refresh. */
export function familyLocationStatus(location: FamilyVehicleLocation | null | undefined, now: number, sharingActive: boolean) {
  if (!sharingActive) return { state: 'ended', label: 'Live location access ended', ageSeconds: null } as const;
  if (!location) return { state: 'unavailable', label: 'Vehicle location unavailable', ageSeconds: null } as const;
  const ageSeconds = Math.max(0, Math.floor((now - location.capturedAt) / 1000));
  const stale = location.stale || ageSeconds >= 30;
  return { state: stale ? 'stale' : 'recent', label: stale ? 'Last known vehicle location' : 'Recent vehicle location', ageSeconds } as const;
}
