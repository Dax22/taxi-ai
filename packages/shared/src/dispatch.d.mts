export type DispatchMode = 'sequential' | 'batch';
export type DispatchEtaSource = 'road' | 'distance_fallback' | 'sample';
export type DispatchReason = 'road_pickup_eta' | 'distance_fallback' | 'sample_area' | 'waiting_priority';
export interface DispatchCandidate {
  driverId: string; rideId: string; pickupEtaSeconds: number | null;
  distanceMeters: number | null; createdAt: number; expiresAt: number;
}
export interface DispatchMetadata {
  policyVersion: 'pickup-eta-wait-v1'; mode: DispatchMode;
  algorithm: 'greedy' | 'min_cost_max_flow'; etaSource: DispatchEtaSource; reasons: DispatchReason[];
}
export type DispatchOffer<T extends DispatchCandidate = DispatchCandidate> = T & {
  offerExpiresAt: number; dispatch: DispatchMetadata;
};
export const DISPATCH_POLICY: Readonly<{
  version: 'pickup-eta-wait-v1'; offerTtlMs: number; maxDrivers: number; maxRides: number; maxEdges: number;
  maxPickupEtaSeconds: number; maxDistanceMeters: number; fallbackSpeedMetersPerSecond: number;
  fallbackPenaltySeconds: number; samplePickupCostSeconds: number; waitingPriorityMs: number;
  waitingCreditLimitMs: number;
}>;
export const DISPATCH_REASON_LABELS: Readonly<Record<DispatchReason, string>>;
export function boundedDispatchCandidates<T extends DispatchCandidate>(candidates: T[], now: number): T[];
export function allocateDispatchOffers<T extends DispatchCandidate>(candidates: T[], now: number,
  options?: { mode?: DispatchMode }): Array<DispatchOffer<T>>;
