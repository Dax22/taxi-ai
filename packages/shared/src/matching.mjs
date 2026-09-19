/** Preview matching policy. Distances are straight-line, never driving ETAs. */
export const REQUEST_MS = 5 * 60_000;
export const EXPAND_MS = 60_000;
export const AVAILABILITY_MS = 60_000;
export const POSITION_MS = 30_000;
export const INITIAL_RADIUS_METERS = 5000;
export const EXPANDED_RADIUS_METERS = 10_000;
export const searchRadius = (createdAt, now) => now - createdAt >= EXPAND_MS ? EXPANDED_RADIUS_METERS : INITIAL_RADIUS_METERS;
