export type DeliveryUpdateKind = 'food' | 'parcel';
export interface DeliveryUpdate {
  id: string; kind: DeliveryUpdateKind; targetId: string; phase: 'picked_up' | 'arrived' | 'delivered';
  title: string; body: string; note: string; etaMinutes: number | null; createdAt: number; readAt: number | null;
}
export interface DeliveryUpdates { updates: DeliveryUpdate[]; unread: number; nextBefore: string | null }
export interface DeliveryUpdateDetail { update: DeliveryUpdate | null }
export interface DeliveryUpdateTarget { target: { screen: 'food-order' | 'journey' | 'parcels'; id: string } }
export function readDeliveryUpdate(value: unknown, expected: { kind: DeliveryUpdateKind; targetId: string }): DeliveryUpdateDetail;
export function readDeliveryUpdates(value: unknown): DeliveryUpdates;
export function readDeliveryUpdateTarget(value: unknown): DeliveryUpdateTarget;
