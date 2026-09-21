export type VehicleCategoryId = 'standard' | 'suv' | 'van' | 'truck' | 'motorcycle';
export interface VehicleCategory {
  readonly id: VehicleCategoryId;
  readonly name: string;
  readonly purpose: string;
  readonly statusLabel: string;
  readonly ridePreview: boolean;
  readonly assetPath: string;
  readonly imageDescription: string;
  readonly description: string;
}
export const VEHICLE_CATEGORIES: readonly VehicleCategory[];
export function vehicleCategory(id: unknown): VehicleCategory | null;
