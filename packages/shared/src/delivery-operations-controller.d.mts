import type { DeliveryOperations } from './delivery-operations.mjs';
export interface DeliveryOperationsState { data: DeliveryOperations | null; error: string; busy: boolean; loading: boolean; uncertain: boolean }
export interface DeliveryOperationsController {
  snapshot(): DeliveryOperationsState;
  subscribe(fn: () => void): () => void;
  context(accountId: string | null, rideId: string | null): void;
  refresh(): Promise<void>;
  command(action: string, extra?: Record<string, unknown>): Promise<void>;
  retry(): Promise<void>;
  tick(): void;
  close(): void;
}
export function createDeliveryOperationsController(options: {
  read(id: string): Promise<unknown>;
  write(id: string, data: Record<string, unknown>, key: string): Promise<unknown>;
  verify(owner: string): Promise<boolean>;
  makeKey(): string;
  now?: () => number;
}): DeliveryOperationsController;
