import type { FoodStore, FoodMenuItem, FoodQuote, FoodTotals } from './eats.mjs';
export interface MealOption { store: FoodStore; item: FoodMenuItem }
export interface MealLine extends MealOption { quantity: number }
export interface MealCheckout { id: string; quotes: FoodQuote[]; totals: FoodTotals; expiresAt: number }
export const MEAL_LIMITS: Readonly<{ kitchens: number; lines: number; quantity: number; totalKobo: number }>;
export function mealTerms(query: string): string[];
export function matchMeals(foods: MealOption[], query: string): MealOption[];
export function mealQuantity(basket: MealLine[], food: MealOption, quantity: number): MealLine[];
export function mealGroups(basket: MealLine[]): { storeId: string; expectedVersion: number; items: { itemId: string; quantity: number }[] }[];
export function mealTotals(quotes: { totals: FoodTotals }[]): FoodTotals;
