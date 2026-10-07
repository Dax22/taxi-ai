import type { LocationShare, Position } from './contracts.ts';

export type TrackingKind = 'ride' | 'food';
export interface BackgroundConnection { origin: string; previewAccess?: string }
export interface BackgroundGrant {
  token: string; expiresAt: number; kind: TrackingKind; jobId: string; shareId: string; clientId: string; sequence: number;
}
/** No account access/refresh credentials, coordinates, or location history belong in this record. */
export interface BackgroundLease extends BackgroundGrant {
  version: 1; savedAt: number; serverNow: number; lastSuccessAt: number; connection?: BackgroundConnection;
}
export interface BackgroundBinding { kind: TrackingKind; jobId: string; clientId: string }
export interface BackgroundTrackingApi {
  position(token: string, sequence: number, position: Position, connection?: BackgroundConnection): Promise<{ share: LocationShare; serverNow: number }>;
  stop(token: string, connection?: BackgroundConnection): Promise<void>;
}
export interface BackgroundVault { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> }
export interface BackgroundNative { start(): Promise<void>; stop(): Promise<void>; permissions(): Promise<boolean> }
export interface ControllerBackground {
  prepare(isCurrent: () => boolean): Promise<void>;
  start(share: LocationShare, serverNow: number, isCurrent: () => boolean): Promise<void>;
  stop(): Promise<void>;
  active(): Promise<boolean>;
  recovering?(): Promise<boolean>;
}
