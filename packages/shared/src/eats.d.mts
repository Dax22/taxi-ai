import type { Vehicle } from './mobile-contracts.mjs';
export type FoodStatus = 'placed' | 'accepted' | 'preparing' | 'ready' | 'assigned' | 'picked_up' | 'arrived' | 'delivered' | 'cancelled' | 'rejected';
export type FoodAction = 'accept' | 'reject' | 'prepare' | 'ready' | 'claim' | 'pickup' | 'arrive' | 'deliver' | 'cancel';
export interface FoodArea { id: string; name: string }
export interface FoodStoreDetails { name: string; cuisine: string; description: string; address: string; areaId: string; prepMinutes: number; minimumKobo: number; deliveryFeeKobo: number }
export interface FoodStore extends FoodStoreDetails { id: string; version: number; status: 'pending' | 'approved' | 'suspended'; isOpen: boolean; reviewNote?: string; createdAt: number; updatedAt: number }
export interface FoodMenuItem { id: string; name: string; description: string; category: string; priceKobo: number; available: boolean }
export interface CartLine { itemId: string; quantity: number }
export interface FoodTotals { subtotalKobo: number; deliveryFeeKobo: number; serviceFeeKobo: number; totalKobo: number; currency: 'NGN' }
export interface FoodQuote { id: string; restaurant: { id: string; name: string; address: string; areaId: string; prepMinutes: number }; lines: (CartLine & { name: string; description: string; priceKobo: number })[]; totals: FoodTotals; address: { line?: string; areaId: string }; instructions: string; isDemo: true; payment: { method: 'test'; status: 'not_charged' }; expiresAt: number }
export interface FoodOrder extends Omit<FoodQuote, 'expiresAt'> { status: FoodStatus; version: number; role: 'customer' | 'store' | 'courier' | 'admin'; actions: FoodAction[]; customerName: string; courier: { id: string; name: string; vehicle: Vehicle } | null; pickupPin?: string; deliveryPin?: string; pinBlockedUntil?: number | null; events: { status: FoodStatus; at: number; reason?: string }[]; createdAt: number; updatedAt: number }
export interface FoodJob { id: string; version: number; restaurant: FoodQuote['restaurant']; deliveryArea: FoodArea; deliveryFeeKobo: number; createdAt: number; isDemo: true }
export interface FoodWork { current: FoodOrder[]; available: FoodJob[]; online: boolean; eligible: boolean; isDemo: true }
export const EATS_CUISINES: readonly string[];
export const EATS_STATUS: Readonly<Record<FoodStatus, string>>;
export const EATS_STEPS: readonly FoodStatus[];
export const EATS_TERMINAL: readonly FoodStatus[];
export const EATS_COLOURS: Readonly<Record<string, string>>;
export const EATS_SYMBOLS: Readonly<Record<string, string>>;
export function eatsTotals(lines: { priceKobo: number; quantity: number }[], deliveryFeeKobo: number): FoodTotals;
export function cartQuantity(cart: CartLine[], itemId: string, quantity: number): CartLine[];
export function eatsActions(order: { status: FoodStatus }, role: string): FoodAction[];
