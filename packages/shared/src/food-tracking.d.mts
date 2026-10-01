import type { Position } from './mobile-journeys.mjs';
export interface FoodLocationShare {
  id: string; orderId: string; active: boolean; owned: boolean; sequence: number;
  startedAt: number; updatedAt: number | null; stale: boolean; position: Position | null;
}
export interface FoodTracking { orderId: string; isCourier: boolean; canShare: boolean; required: boolean; share: FoodLocationShare | null; serverNow: number }
export interface FoodTrackingResult { share: FoodLocationShare; replayed: boolean; serverNow: number }
export function readFoodTracking(value: unknown, orderId: string): FoodTracking;
export function readFoodTrackingResult(value: unknown, expected?: { orderId?: string; shareId?: string; stopped?: boolean }): FoodTrackingResult;
