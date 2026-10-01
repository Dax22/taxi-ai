import type { FoodDeliveryAddress } from '../../../../packages/shared/src/eats.mjs';

export interface DeliveryAddressDraft { address: FoodDeliveryAddress; profileVersion: number | null; dirty: boolean }
const copy = (address: FoodDeliveryAddress): FoodDeliveryAddress => ({ ...address, point: address.point ? { ...address.point } : null });

export function deliveryAddressDraft(address: FoodDeliveryAddress, profileVersion: number | null): DeliveryAddressDraft {
  return { address: copy(address), profileVersion, dirty: Boolean(address.line || address.areaId || address.point) };
}
export function editDeliveryAddressDraft(draft: DeliveryAddressDraft, change: Partial<FoodDeliveryAddress>, profileVersion: number | null): DeliveryAddressDraft {
  return { address: { ...draft.address, ...change, point: null }, dirty: true, profileVersion: draft.dirty ? draft.profileVersion : profileVersion };
}
export function confirmDeliveryAddressDraft(draft: DeliveryAddressDraft, address: FoodDeliveryAddress, profileVersion: number | null): DeliveryAddressDraft {
  return { address: copy(address), dirty: true, profileVersion: draft.dirty ? draft.profileVersion : profileVersion };
}
export function savedDeliveryAddressDraft(address: FoodDeliveryAddress, profileVersion: number): DeliveryAddressDraft {
  return { ...deliveryAddressDraft(address, profileVersion), dirty: true };
}
export function staleDeliveryAddressDraft(draft: DeliveryAddressDraft, profileVersion: number | null): boolean {
  return draft.dirty && draft.profileVersion !== profileVersion;
}
