import type { FoodOrder } from '../../../../packages/shared/src/eats.mjs';

export function showFoodOrderTracking(order: Pick<FoodOrder, 'fulfillment' | 'role' | 'status' | 'courier'>): boolean {
  return order.fulfillment !== 'pickup' && ['customer', 'courier'].includes(order.role) && Boolean(order.courier)
    && ['assigned', 'picked_up', 'arrived'].includes(order.status);
}
