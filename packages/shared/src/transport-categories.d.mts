import type { VehicleCategoryId } from './vehicle-categories.mjs';
export interface DeliveryDetails { description: string; weightKg: number; recipientName: string; pickupInstructions: string; dropoffInstructions: string }
export interface TransportCategory { readonly service: 'ride' | 'delivery'; readonly multiplier: number; readonly maxLoadKg: number | null }
export const TRANSPORT_CATEGORIES: Readonly<Record<VehicleCategoryId, TransportCategory>>;
export function transportCategory(id?: unknown): TransportCategory | null;
export function categoryFare(kobo: number, id?: VehicleCategoryId): number;
export function validPayload(categoryId: unknown, value: unknown): boolean;
export function deliveryDetails(categoryId: VehicleCategoryId, data?: unknown): DeliveryDetails | null;
export function vehicleMatches(vehicle: { category?: VehicleCategoryId; payloadKg?: number | null } | null | undefined, categoryId: VehicleCategoryId, weightKg?: number | null): boolean;
