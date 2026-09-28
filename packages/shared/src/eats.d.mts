import type { Vehicle } from './mobile-contracts.mjs';
export type FoodStatus = 'placed' | 'accepted' | 'preparing' | 'ready' | 'assigned' | 'picked_up' | 'arrived' | 'delivered' | 'cancelled' | 'rejected';
export type FoodAction = 'accept' | 'reject' | 'prepare' | 'ready' | 'claim' | 'pickup' | 'arrive' | 'deliver' | 'complete_pickup' | 'cancel';
export interface FoodArea { id: string; name: string; town?: string; stateId?: string; stateName?: string }
export type FoodFulfillment = 'delivery' | 'pickup';
export type FoodRecipient = { kind: 'self' } | { kind: 'other'; name: string; phone: string };
export type FoodSellerType = 'restaurant' | 'food_vendor' | 'home_kitchen';
export interface FoodStoreDetails { dispatchPoint?: { lat: number; lng: number } | null; sellerType?: FoodSellerType; deliveryEnabled?: boolean; deliveryAreaIds?: string[]; pickupEnabled?: boolean; name: string; cuisine: string; description: string; address: string; areaId: string; prepMinutes: number; minimumKobo: number; deliveryFeeKobo: number }
export interface FoodStore extends FoodStoreDetails { town?: string; addressHidden?: boolean; coverPhotoId?: string | null; id: string; version: number; status: 'pending' | 'approved' | 'suspended'; isOpen: boolean; reviewNote?: string; createdAt: number; updatedAt: number }
export interface FoodDish extends FoodMenuItem { seller: FoodStore }
export interface FoodMenuItem { photoVersion?: number | null; portionsRemaining?: number | null; allergens?: string; photoId?: string | null; id: string; name: string; description: string; category: string; priceKobo: number; available: boolean }
export interface CartLine { itemId: string; quantity: number }
export interface FoodTotals { subtotalKobo: number; deliveryFeeKobo: number; serviceFeeKobo: number; totalKobo: number; currency: 'NGN' }
export interface FoodQuote { fulfillment?: FoodFulfillment; recipient?: FoodRecipient; id: string; restaurant: { sellerType?: FoodSellerType; addressHidden?: boolean; id: string; name: string; address: string; areaId: string; prepMinutes: number }; lines: (CartLine & { name: string; description: string; allergens?: string; priceKobo: number })[]; totals: FoodTotals; address: { line?: string; areaId: string }; instructions: string; isDemo: true; payment: { method: 'test'; status: 'not_charged' }; expiresAt: number }
export interface FoodOrder extends Omit<FoodQuote, 'expiresAt'> { needsCollectionPoint?: boolean; status: FoodStatus; version: number; role: 'customer' | 'store' | 'courier' | 'admin'; actions: FoodAction[]; customerName: string; courier: { id: string; name: string; vehicle: Vehicle } | null; pickupPin?: string; deliveryPin?: string; pinBlockedUntil?: number | null; events: { status: FoodStatus; at: number; reason?: string }[]; createdAt: number; updatedAt: number }
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
export function eatsActions(order: { status: FoodStatus; fulfillment?: FoodFulfillment }, role: string): FoodAction[];

export const EATS_SELLERS: Readonly<Record<FoodSellerType, string>>;
export const EATS_DISPATCH_RADIUS_METERS: number;
export const EATS_LEGACY_AREA_IDS: readonly string[];
export function deliveryAreas(store: Pick<FoodStoreDetails, 'areaId' | 'deliveryAreaIds'>): readonly string[];
export function isPrivateKitchen(sellerType?: FoodSellerType): boolean;
export function foodAvailable(item: Pick<FoodMenuItem, 'available' | 'portionsRemaining'>): boolean;
export function foodStock(item: Pick<FoodMenuItem, 'available' | 'portionsRemaining'>): string;
export function discoverKitchens(stores: FoodStore[], filters?: { q?: string; cuisine?: string; areaId?: string; sellerType?: string; fulfillment?: string; openOnly?: boolean; sort?: string }): FoodStore[];
