export type DeliveryOperationState = 'normal' | 'exception' | 'return_requested' | 'return_authorized' | 'returned' | 'delivered' | 'closed';
export interface DeliveryOperations {
  rideId: string; version: number; state: DeliveryOperationState;
  events: Array<{ id: string; kind: string; label: string; createdAt: number; version: number; note?: string }>;
  evidence: null | { reference: string; verifiedAt: number; method: 'recipient_pin'; locationRecorded: boolean;
    position?: null | { lat: number; lng: number; accuracy: number; capturedAt: number } };
  can: { report: boolean; requestReturn: boolean; authorizeReturn: boolean; confirmReturn: boolean; resolve: boolean };
}
export const DELIVERY_OPERATION_STATES: Readonly<Record<DeliveryOperationState, string>>;
export function readDeliveryOperations(body: unknown, rideId: string): DeliveryOperations;
