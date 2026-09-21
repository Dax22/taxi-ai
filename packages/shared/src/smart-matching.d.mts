export type MatchReason = 'nearby_pickup' | 'within_search_area' | 'sample_area' | 'waiting_longer';
export interface MatchRecommendation { policyVersion: 'proximity-wait-v1'; rank: number; reasons: MatchReason[] }
export interface MatchCandidate { id: string; createdAt: number; expiresAt: number; distanceMeters: number | null }
export const MATCH_RANKING_POLICY: Readonly<{ version: 'proximity-wait-v1'; proximityWeight: number; waitingWeight: number;
  distanceScaleMeters: number; waitingScaleMs: number; nearbyMeters: number; waitingReasonMs: number }>;
export const MATCH_REASON_LABELS: Readonly<Record<MatchReason, string>>;
export function rankEligibleMatches<T extends MatchCandidate>(candidates: T[], now: number): Array<T & { recommendation: MatchRecommendation }>;
export function validMatchRecommendation(value: unknown): value is MatchRecommendation;
