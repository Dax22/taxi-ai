import type { VehicleIdentity } from './vehicle-profile.mjs';
export function arrivalNotice(driver: { name: string; vehicle: Partial<VehicleIdentity> } | null | undefined): { title: string; body: string } | null;
export function vehicleMismatchReport(note?: string): { kind: 'unsafe_behaviour'; note: string; contactIds: string[] };
