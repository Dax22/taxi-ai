export interface VehicleIdentity { model: string; plate: string; make?: string; modelName?: string; year?: number; colour?: string }
export interface VehicleColour { readonly id: string; readonly name: string; readonly hex: string }
export const VEHICLE_MAKES: Readonly<Record<string, readonly string[]>>;
export const VEHICLE_COLOURS: readonly VehicleColour[];
export function modelsForMake(make: string): readonly string[];
export function vehicleColour(value?: string): VehicleColour | null;
export interface VehiclePresentation { title: string; plate: string; description: string; colourId: string; paint: string;
  illustrationNote: string; visualMatch: 'illustration'; assetPath: string }
export function vehiclePresentation(vehicle?: Partial<VehicleIdentity>): Readonly<VehiclePresentation>;
