import { LEGACY_FOOD_AREAS } from '../../../../packages/shared/src/nigeria-areas.mjs';
import type { FoodStore, FoodSellerType } from '../../../../packages/shared/src/eats.mjs';

export const storeDraft = (store: FoodStore | null, initialType: FoodSellerType = 'restaurant') => ({
  sellerType: store?.sellerType ?? initialType,
  deliveryAreaIds: [...(store?.deliveryAreaIds ?? (store
    ? LEGACY_FOOD_AREAS.some((area) => area.id === store.areaId) ? LEGACY_FOOD_AREAS.map((area) => area.id) : [store.areaId]
    : []))],
  dispatchPoint: store?.dispatchPoint ?? null,
  deliveryEnabled: store?.deliveryEnabled !== false, pickupEnabled: store?.pickupEnabled ?? false,
  name: store?.name ?? '', cuisine: store?.cuisine ?? 'Nigerian', description: store?.description ?? '',
  address: store?.address ?? '', areaId: store?.areaId ?? '', prepMinutes: String(store?.prepMinutes ?? 25),
  minimum: String((store?.minimumKobo ?? 0) / 100), fee: String((store?.deliveryFeeKobo ?? 150_000) / 100),
});

/** A new kitchen starts with its own town only; changing town never widens coverage. */
export function changeStoreLocation(draft: ReturnType<typeof storeDraft>, areaId: string) {
  const ownTownOnly = !draft.deliveryAreaIds.length || draft.deliveryAreaIds.length === 1 && draft.deliveryAreaIds[0] === draft.areaId;
  return { ...draft, areaId, ...(areaId !== draft.areaId ? { dispatchPoint: null } : {}), ...(ownTownOnly ? { deliveryAreaIds: areaId ? [areaId] : [] } : {}) };
}
