import type { GuestView } from './guest-rides.mjs';
export interface GuestRideState { value: GuestView | null; loading: boolean; pending: boolean; uncertain: boolean; error: string; token: string | null }
export interface GuestRideController { snapshot(): GuestRideState; subscribe(listener: () => void): () => void;
  context(value: { userId: string; rideId: string } | null): Promise<void>; load(): Promise<void>; pause(): void; tick(): void;
  create(): Promise<boolean>; replace(): Promise<boolean>; revoke(): Promise<boolean>; retry(): Promise<boolean> }
export function createGuestRideController(options: { api: { request(path: string): Promise<unknown>; command(path: string, data: Record<string, unknown>, key: string): Promise<unknown> };
  makeKey: () => string; now?: () => number }): GuestRideController;
