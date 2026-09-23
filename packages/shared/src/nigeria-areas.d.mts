export type NigerianState = { readonly id: string; readonly name: string };
export type FoodArea = {
  readonly id: string;
  readonly name: string;
  readonly town: string;
  readonly stateId: string;
  readonly stateName: string;
};
export const NIGERIAN_STATES: readonly NigerianState[];
export const LEGACY_FOOD_AREAS: readonly FoodArea[];
/** Throws for an unknown state or invalid town. */
export function foodAreaId(stateId: string, town: string): string;
/** Returns null for malformed, unknown or noncanonical area IDs. */
export function resolveFoodArea(id: unknown): FoodArea | null;
