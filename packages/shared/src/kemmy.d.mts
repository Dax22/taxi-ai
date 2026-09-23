export interface KemmyRide { status: string; service?: string; delivery?: unknown; destination: string | { name: string };
  driver?: { name: string; vehicle: { make?: string; model?: string; modelName?: string; colour?: string } } | null;
  route?: { pickup: { lat: number; lng: number }; durationSeconds: number | null } | null;
  startedAt?: number | null; trip?: { startedAt?: number | null } | null; rating?: number | null }
export interface KemmyMessage { phase: 'pickup' | 'arrived' | 'trip' | 'rate'; pickupMinutes: number | null; tripMinutes: number | null; message: string; note: string }
export function kemmyUpdate(ride: KemmyRide | null, options?: { position?: { lat: number; lng: number } | null; now?: number; stale?: boolean }): KemmyMessage | null;
