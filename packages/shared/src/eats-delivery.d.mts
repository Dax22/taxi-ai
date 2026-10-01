import type { FoodDeliveryAddress, FoodRecipient, FoodPoint } from './eats.mjs';
export const OUTSIDE_NIGERIA_FOOD_MESSAGE: string;
export function normalizeFoodPoint(value: unknown): FoodPoint;
export function normalizeFoodAddress(value: unknown): FoodDeliveryAddress;
export function normalizeFoodRecipient(value?: unknown, accountName?: string): FoodRecipient;
